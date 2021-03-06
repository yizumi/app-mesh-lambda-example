import AWS, { SSM } from 'aws-sdk';
import ECS, {
    CreateServiceRequest,
    CreateTaskSetRequest,
    DeleteTaskSetRequest,
    ServiceRegistries,
    TaskDefinition,
    UpdateServicePrimaryTaskSetRequest
} from "aws-sdk/clients/ecs";
import ServiceDiscovery, {
    GetInstancesHealthStatusRequest,
    ResourceId,
    ServiceSummary
} from "aws-sdk/clients/servicediscovery";
import AppMesh, {CreateVirtualNodeInput, VirtualNodeData} from "aws-sdk/clients/appmesh";
import moment from "moment";
import {IAppMeshGrpcServiceProps} from "./IAppMeshGrpcServiceProps";

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default class AppMeshGrpcService {
    private appmesh: AppMesh;
    private ecs: ECS;
    private sd: ServiceDiscovery;
    private readonly props: IAppMeshGrpcServiceProps;
    private ssm: SSM;

    constructor(props: IAppMeshGrpcServiceProps) {
        this.appmesh = new AWS.AppMesh();
        this.ecs = new AWS.ECS();
        this.sd = new AWS.ServiceDiscovery();
        this.ssm = new AWS.SSM();
        this.props = props;
    }

    async deploy(): Promise<void> {
        console.info('Deploy Properties', JSON.stringify(this.props));
        await this.deleteUnusedResources();
        await this.createServiceIfMissing();
        const virtualNode = await this.createVirtualNode();
        await this.putVirtualNodeNameOnSSM(virtualNode);
        await this.createTaskSet(virtualNode);
        await this.waitForEcsServices();
        await this.switchTrafficRoute(virtualNode);
    }

    private async createServiceIfMissing() {
        const { clusterName, privateSubnets, ecsServiceName } = this.props;

        try {
            const service = await this.getService();
            if (!service) {
                throw Error('Service not found. Creating...')
            } else {
                console.info(`Found service '${service.serviceArn}'`);
            }
        } catch(_) {
            const req: CreateServiceRequest = {
                cluster: clusterName,
                serviceName: ecsServiceName,
                desiredCount: privateSubnets.length,
                deploymentConfiguration: {
                    maximumPercent: 200,
                    minimumHealthyPercent: 100,
                },
                schedulingStrategy: "REPLICA",
                deploymentController: {
                    type: "EXTERNAL",
                },
            };
            console.info(`Missing service '${ecsServiceName}'. Creating...`)
            const { service } = await this.ecs.createService(req).promise();
            console.info('Successfully created service', JSON.stringify(service));
        }
    }

    private async createVirtualNode(): Promise<AppMesh.VirtualNodeData> {
        const {serviceName, meshName, namespaceName, port} = this.props;
        const virtualNodeName = `${serviceName}-${moment().format('YYYYMMDDhhmmss')}`;
        const req: CreateVirtualNodeInput = {
            meshName,
            virtualNodeName,
            spec: {
                serviceDiscovery: {
                    awsCloudMap: {
                        namespaceName,
                        serviceName,
                        attributes: [
                            {key: 'ECS_TASK_SET_EXTERNAL_ID', value: `${virtualNodeName}-task-set`}
                        ]
                    }
                },
                listeners: [
                    {
                        healthCheck: {
                            healthyThreshold: 2,
                            intervalMillis: 5000,
                            port,
                            protocol: 'grpc',
                            timeoutMillis: 2000,
                            unhealthyThreshold: 3,
                        },
                        portMapping: {
                            port,
                            protocol: 'grpc',
                        },
                    }
                ],
            },
        };
        console.info('Creating virtual node', JSON.stringify(req));
        const res = await this.appmesh.createVirtualNode(req).promise();
        console.info('Successfully created a new virtual node', JSON.stringify(res.virtualNode));
        return res.virtualNode;
    }

    private async putVirtualNodeNameOnSSM(virtualNode: VirtualNodeData): Promise<void> {
        const {meshName, virtualNodeSSMParameterName } = this.props;
        const {virtualNodeName} = virtualNode;

        await this.ssm.putParameter({
            Name: this.props.virtualNodeSSMParameterName,
            Description: `Set by AppMeshGrpcService on ${moment().format('YYYY-MM-DD hh:mm:ss')}`,
            Tier: 'Standard',
            Type: 'String',
            DataType: 'text',
            Value: `mesh/${meshName}/virtualNode/${virtualNodeName}`,
            Overwrite: true,
        }).promise();
    }

    private async createTaskSet(virtualNode: AppMesh.VirtualNodeData): Promise<ECS.TaskSet | undefined> {
        const {clusterName, privateSubnets, securityGroups} = this.props;
        const {virtualNodeName} = virtualNode;

        const service = await this.getService();
        const taskDefArn = await this.getTaskDefArn();
        const cmapService = await this.getCmapService();

        const req: CreateTaskSetRequest = {
            service: service.serviceArn as string,
            cluster: clusterName,
            externalId: `${virtualNodeName}-task-set`,
            taskDefinition: taskDefArn,
            serviceRegistries: [{registryArn: cmapService.Arn}] as ServiceRegistries,
            scale: {unit: 'PERCENT', value: 100},
            launchType: 'FARGATE',
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: privateSubnets,
                    securityGroups: securityGroups,
                    assignPublicIp: 'ENABLED',
                }
            }
        };

        console.info('Creating Task Set', JSON.stringify(req));
        const {taskSet} = await this.ecs.createTaskSet(req).promise();
        if (!taskSet) {
            throw Error('Failed to create Task Set');
        }
        console.info('Successfully created Task Set', JSON.stringify(taskSet));

        const ptsReq:UpdateServicePrimaryTaskSetRequest = {
            cluster: clusterName,
            service: service.serviceName as string,
            primaryTaskSet: taskSet.taskSetArn as string,
        };
        console.info('Updating Primary Task Set', ptsReq);
        const {taskSet:ptsTaskSet} = await this.ecs.updateServicePrimaryTaskSet(ptsReq).promise();
        console.info('Successfully update Primary Task Set', JSON.stringify(ptsTaskSet));
        return taskSet;
    }

    private async waitForEcsServices(): Promise<boolean> {
        const {clusterName, ecsServiceName} = this.props;

        const cmapService = await this.getCmapService();

        const countUnhealthyTasks = async (): Promise<number> => {
            const {taskArns} = await this.ecs.listTasks({cluster: clusterName, serviceName: ecsServiceName}).promise();
            if (!taskArns || !taskArns.length) {
                console.warn('No taskArns found for ', clusterName, ecsServiceName);
                return 0;
            }
            const {tasks} = await this.ecs.describeTasks({cluster: clusterName, tasks: taskArns}).promise();
            console.info('Tasks', tasks?.reduce((acc:{[Identifier:string]:string}, t) => {
                const taskId = t.taskArn?.match(/\/(.*)$/)?.[1];
                const taskDefId = t.taskDefinitionArn?.match(/\/(.*)$/)?.[1];
                const identifier = `${taskId}-${taskDefId}`;
                acc[identifier] = t.lastStatus as string;
                return acc;
            }, {}));
            return tasks?.filter(t => t.lastStatus != 'RUNNING').length || 0;
        };

        const countUnhealthyInstances = async (): Promise<number> => {
            const req: GetInstancesHealthStatusRequest = {
                ServiceId: cmapService.Id as ResourceId,
            };
            try {
                const {Status: status} = await this.sd.getInstancesHealthStatus(req).promise();
                console.info('Status', status);
                return status ? Object.keys(status)?.filter(k => status[k] != 'HEALTHY').length || 0 : 0;
            } catch(e) {
                console.warn('Could not query health status for cmap instance', JSON.stringify(req));
                return 0;
            }
        };

        while (await countUnhealthyTasks() == 0) {
            console.info('Waiting for unhealthy tasks');
            await delay(5000);
        }

        while (await countUnhealthyTasks() != 0) {
            console.info('Waiting for all unhealthy tasks to be RUNNING');
            await delay(5000);
        }

        while (await countUnhealthyInstances() == 0) {
            console.info('Waiting for unhealthy instances');
            await delay(5000);
        }

        while (await countUnhealthyInstances() != 0) {
            console.info('Waiting for all unhealthy instances to be HEALTHY');
            await delay(5000);
        }

        return true;
    }

    private async switchTrafficRoute(virtualNode: VirtualNodeData): Promise<AppMesh.RouteData> {
        const {meshName, virtualRouterName, routeName} = this.props;
        const {route} = await this.appmesh.describeRoute({meshName, virtualRouterName, routeName}).promise();
        const action = route?.spec?.grpcRoute?.action;
        if (!route || !route.spec || !action || !action.weightedTargets) {
            throw Error('No weighted targets found');
        }
        action.weightedTargets = [{virtualNode: virtualNode.virtualNodeName, weight: 1}];
        const req = {
            meshName,
            virtualRouterName,
            routeName,
            spec: route.spec
        };
        console.info('Switching traffic route', JSON.stringify(req));
        const {route: rt} = await this.appmesh.updateRoute(req).promise();
        console.info('Successfully switched traffic route', JSON.stringify(rt));
        return rt;
    }

    private async deleteUnusedResources() {
        console.info('Deleting unused resource');
        // Find which node is used
        const { meshName, virtualRouterName, routeName, serviceName, ecsServiceName, clusterName } = this.props;

        // List all related virtual nodes
        const { virtualNodes } = await this.appmesh.listVirtualNodes({ meshName}).promise();
        const matcher = new RegExp(`^${serviceName}-([0-9]+)$`);
        const virtualNodeNames = virtualNodes?.filter(n => n.virtualNodeName.match(matcher))?.map(n => n.virtualNodeName);

        // Find which is used and which are not used
        const { route } = await this.appmesh.describeRoute({ meshName, virtualRouterName, routeName}).promise();
        const weightedTargets = route?.spec?.grpcRoute?.action?.weightedTargets?.filter(t => t.weight > 0);
        if (!weightedTargets || weightedTargets.length == 0) {
            console.warn('Missing valid weightedTargets');
            return false;
        }
        const usedVirtualNodes = virtualNodeNames.filter(n => weightedTargets.findIndex(t => t.virtualNode == n) > -1);
        console.info('Used virtual nodes', JSON.stringify(usedVirtualNodes));
        const unusedVirtualNodes = virtualNodeNames.filter(n => weightedTargets.findIndex(t => t.virtualNode == n) == -1);
        console.info('Unused virtual nodes', JSON.stringify(unusedVirtualNodes));

        // For each taskSet in service, see if it uses one of the unusedVirtualNodes, if so, we can delete task set
        const { services } = await this.ecs.describeServices({cluster: clusterName, services: [ecsServiceName]}).promise();
        const taskSets = services?.[0]?.taskSets;
        if (!taskSets) {
            console.warn('Missing taskSets');
            return false;
        }

        await this.deleteTaskSets(taskSets, unusedVirtualNodes);
        await this.deleteVirtualNodes(unusedVirtualNodes, meshName);
    }

    private async getService(): Promise<ECS.Service> {
        const {clusterName, ecsServiceName} = this.props;
        const {services} = await this.ecs.describeServices({cluster: clusterName, services: [ecsServiceName]}).promise();
        const service = services?.[0];
        if (!service || service.status != "ACTIVE") {
            throw Error(`Missing active service with name '${ecsServiceName}'. Make sure you have this defined`);
        }
        return service;
    }

    private async getTaskDefArn(): Promise<string> {
        const {taskDefinitionName} = this.props;
        const {taskDefinitionArns} = await this.ecs.listTaskDefinitions().promise();
        const taskDefArn = taskDefinitionArns?.filter((a: string) => a.match(/\/(.*):([0-9]+)$/)?.[1] == taskDefinitionName);
        if (!taskDefArn) {
            throw Error(`Missing Task Def with name '${taskDefinitionName}' in ECS. Make sure you have this defined.`);
        }
        return taskDefArn[taskDefArn.length - 1];
    }

    private async getCmapService(): Promise<ServiceSummary> {
        const {serviceName, namespaceName} = this.props;
        const {Namespaces: namespaces} = await this.sd.listNamespaces().promise();
        const namespace = namespaces?.find(n => n.Name == namespaceName);
        if (!namespace) {
            throw Error(`Missing namespace '${namespaceName}' in ServiceDiscovery. Make sure you have it defined in Cloud Map`);
        }
        const {Services: services} = await this.sd.listServices({ Filters:[{Name: "NAMESPACE_ID", Condition: "EQ", Values:[namespace.Id as string]}]}).promise();
        const cmapService = services?.find(s => s.Name == serviceName);
        if (!cmapService || !cmapService?.Arn) {
            throw Error(`Missing service '${serviceName}' in namespace '${namespaceName}'. Make sure you have it defined in Cloud Map`);
        }
        return cmapService;
    }

    private async deleteTaskSets(taskSets: ECS.TaskSet[], unusedVirtualNodeNames: string[]) {
        const { meshName, clusterName, serviceName } = this.props;
        for (const ts of taskSets) {
            const {taskDefinition} = await this.ecs.describeTaskDefinition({taskDefinition: ts.taskDefinition as string}).promise();
            const envoy = taskDefinition?.containerDefinitions?.find(cd => cd.name == 'envoy');
            if (!envoy) {
                console.warn('Missing envoy container definition');
                continue;
            }
            const env = envoy.environment?.find(e => e.name == 'APPMESH_VIRTUAL_NODE_NAME');
            if (!env) {
                console.warn('Missing env with APPMESH_VIRTUAL_NODE_NAME');
                continue;
            }
            if (unusedVirtualNodeNames.findIndex(n => env.value == `mesh/${meshName}/virtualNode/${n}`) == -1) {
                console.debug('Aint guilty', JSON.stringify({env, meshName, unusedVirtualNodes: unusedVirtualNodeNames}));
                continue;
            }
            // yea, it's guilty. lets delete this taskSet
            const req: DeleteTaskSetRequest = {
                cluster: clusterName,
                service: serviceName,
                taskSet: ts.taskSetArn as string,
            };
            console.info('Removing taskSet', JSON.stringify(req));
            try {
                const {taskSet} = await this.ecs.deleteTaskSet(req).promise();
                console.info('Successfully removed taskSet', JSON.stringify(taskSet));
            } catch(e) {
                console.error('Error while deleting task set', JSON.stringify(e));
            }
        }
    }

    private async deleteVirtualNodes(unusedVirtualNodes: string[], meshName: string) {
        for (const virtualNodeName of unusedVirtualNodes) {
            console.info('Removing virtual node', virtualNodeName);
            const {virtualNode} = await this.appmesh.deleteVirtualNode({meshName, virtualNodeName}).promise();
            console.info('Successfully removed virtual node', JSON.stringify(virtualNode));
        }
    }
}