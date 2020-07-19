import AWS from 'aws-sdk';
import ECS, {
    CreateTaskSetRequest,
    RegisterTaskDefinitionRequest,
    ServiceRegistries,
    StringList,
    TaskDefinition
} from "aws-sdk/clients/ecs";
import ServiceDiscovery, {
    GetInstancesHealthStatusRequest,
    ResourceId,
    ServiceSummary
} from "aws-sdk/clients/servicediscovery";
import AppMesh, {
    CreateVirtualNodeInput,
    VirtualNodeData
} from "aws-sdk/clients/appmesh";
import moment from "moment";

export interface IAppMeshGrpcServiceProps {
    /** Name of the AppMesh */
    meshName: string;
    /** Name of the namespace as registered in CloudMap */
    namespaceName: string;
    /** Name of the service as registered in CloudMap */
    serviceName: string;
    /** Port Number to which the gRPC listens */
    port: number;
    /** Name of the virtual router as found in AppMesh */
    virtualRouterName: string;
    /** Name of the route as found in AppMesh */
    routeName: string;
    /** Name of the ECS Cluster the tasks and services run */
    clusterName: string;
}

export interface INetworkConfig {
    subnets: string[];
    securityGroup: string;
    ecsServiceName: string;
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

export default class AppMeshGrpcService {
    private appmesh: AppMesh;
    private ecs: ECS;
    private sd: ServiceDiscovery;
    private readonly props: IAppMeshGrpcServiceProps;


    constructor(props: IAppMeshGrpcServiceProps) {
        this.appmesh = new AWS.AppMesh();
        this.ecs = new AWS.ECS();
        this.sd = new AWS.ServiceDiscovery();
        this.props = props;
    }

    async deploy(): Promise<void> {
        const networkConfig = await this.getNetworkConfiguration();
        const virtualNode = await this.createVirtualNode();
        await this.registerNewTask(virtualNode);
        await this.createTaskSet(virtualNode, networkConfig);
        await this.waitForEcsServices(networkConfig);
        await this.switchTrafficRoute(virtualNode);
    }

    private async getNetworkConfiguration(): Promise<INetworkConfig> {
        const {clusterName, serviceName} = this.props;
        const {serviceArns} = await this.ecs.listServices({cluster: clusterName}).promise();
        const ecsServiceName = serviceArns?.find(s => s.indexOf(serviceName) > -1)?.match(/\/(.*)$/)?.[1];
        if (!ecsServiceName) {
            throw Error('Not ecs service found');
        }
        const {services} = await this.ecs.describeServices({
            cluster: clusterName,
            services: [ecsServiceName]
        }).promise();
        const taskSet = services?.[0].taskSets?.[0];
        if (!taskSet) {
            throw Error('No services/task-sets found');
        }
        const subnets: string[] | undefined = taskSet.networkConfiguration?.awsvpcConfiguration?.subnets;
        if (!subnets) {
            throw Error('Not subnets found');
        }
        const securityGroup = taskSet.networkConfiguration?.awsvpcConfiguration?.securityGroups?.[0];
        if (!securityGroup) {
            throw Error('No security groups found');
        }
        const config: INetworkConfig = {
            subnets,
            securityGroup,
            ecsServiceName,
        };
        console.info('Detected these configurations', JSON.stringify(config));
        return config;
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
        console.info('Creating virtual node', req);
        const res = await this.appmesh.createVirtualNode(req).promise();
        console.info('Successfully created a new virtual node', JSON.stringify(res.virtualNode));
        return res.virtualNode;
    }

    private async registerNewTask(virtualNode: VirtualNodeData): Promise<ECS.TaskDefinition> {
        const {meshName} = this.props;
        const {virtualNodeName} = virtualNode;

        const taskDefArn = await this.getTaskDefArn();
        const taskDefinition = await this.getTaskDefinition(taskDefArn);

        taskDefinition.containerDefinitions?.forEach(def => {
            def.environment?.forEach(env => {
                if (env.name == 'APPMESH_VIRTUAL_NODE_NAME') {
                    env.value = `mesh/${meshName}/virtualNode/${virtualNodeName}`;
                }
            });
        });

        delete (taskDefinition.status);
        delete (taskDefinition.compatibilities);
        delete (taskDefinition.taskDefinitionArn);
        delete (taskDefinition.requiresAttributes);
        delete (taskDefinition.revision);
        // @ts-ignore
        const req: RegisterTaskDefinitionRequest = {...taskDefinition};
        console.info('Registering new task definition', req);
        const {taskDefinition: def} = await this.ecs.registerTaskDefinition(req).promise();
        if (!def) {
            throw Error('No task definition created');
        }
        console.info('Successfully registered new task definition', JSON.stringify(def));
        return def;
    }

    private async getTaskDefinition(taskDefArn: string): Promise<TaskDefinition> {
        const {taskDefinition} = await this.ecs.describeTaskDefinition({taskDefinition: taskDefArn}).promise();
        if (!taskDefinition?.containerDefinitions) {
            throw Error('No task definition or container definitions found');
        }
        return taskDefinition;
    }

    private async createTaskSet(virtualNode: AppMesh.VirtualNodeData, networkConfig: INetworkConfig): Promise<ECS.TaskSet | undefined> {
        const {clusterName} = this.props;
        const {virtualNodeName} = virtualNode;

        const serviceArn = await this.getServiceArn();
        const taskDefArn = await this.getTaskDefArn();
        const cmapService = await this.getCmapService();

        const request: CreateTaskSetRequest = {
            service: serviceArn,
            cluster: clusterName,
            externalId: `${virtualNodeName}-task-set`,
            taskDefinition: taskDefArn,
            serviceRegistries: [{registryArn: cmapService.Arn}] as ServiceRegistries,
            scale: {unit: 'PERCENT', value: 100},
            launchType: 'FARGATE',
            networkConfiguration: {
                awsvpcConfiguration: {
                    subnets: networkConfig.subnets as StringList,
                    securityGroups: [networkConfig.securityGroup],
                    assignPublicIp: 'DISABLED',
                }
            }
        };

        console.info('Creating Task Set', request);
        const {taskSet} = await this.ecs.createTaskSet(request).promise();
        console.info('Successfully created Task Set', JSON.stringify(taskSet));
        return taskSet;
    }

    private async getServiceArn(): Promise<string> {
        const {clusterName, serviceName} = this.props;
        const {serviceArns} = await this.ecs.listServices({cluster: clusterName}).promise();
        const serviceArn = serviceArns?.find(s => s.indexOf(serviceName));
        if (!serviceArn) {
            throw Error('No service Arn found');
        }
        return serviceArn;
    }

    private async getTaskDefArn(): Promise<string> {
        const {serviceName} = this.props;
        const {taskDefinitionArns} = await this.ecs.listTaskDefinitions().promise();
        const taskDefArn = taskDefinitionArns?.filter((a: string) => a.indexOf(serviceName) > -1);
        if (!taskDefArn) {
            throw Error('Not Task Def Arn Detected');
        }
        return taskDefArn[taskDefArn.length - 1];
    }

    private async getCmapService(): Promise<ServiceSummary> {
        const {serviceName} = this.props;
        const {Services: services} = await this.sd.listServices().promise();
        const cmapService = services?.find(s => s.Name == serviceName);
        if (!cmapService || !cmapService?.Arn) {
            throw Error('No Cloud Map Service Arn Found');
        }
        return cmapService;
    }

    private async waitForEcsServices(networkConfig: INetworkConfig): Promise<boolean> {
        const {clusterName} = this.props;
        const {ecsServiceName} = networkConfig;

        const cmapService = await this.getCmapService();

        const countUnhealthyTasks = async (): Promise<number> => {
            const {taskArns} = await this.ecs.listTasks({cluster: clusterName, serviceName: ecsServiceName}).promise();
            if (!taskArns) {
                throw Error('No task arns found');
            }
            const {tasks} = await this.ecs.describeTasks({cluster: clusterName, tasks: taskArns}).promise();
            console.info('Tasks', tasks?.map(t => {
                return {taskArn: t.taskArn, taskDefArn: t.taskDefinitionArn, lastStatus: t.lastStatus}
            }));
            return tasks?.filter(t => t.lastStatus != 'RUNNING').length || 0;
        };

        const countUnhealthyInstances = async (): Promise<number> => {
            const req: GetInstancesHealthStatusRequest = {
                ServiceId: cmapService.Id as ResourceId,
            };
            const {Status: status} = await this.sd.getInstancesHealthStatus(req).promise();
            console.info('Status', status);
            return status ? Object.keys(status)?.filter(k => status[k] != 'HEALTHY').length || 0 : 0;
        };

        while (await countUnhealthyTasks() == 0) {
            console.info('Waiting to seeing unhealthy tasks');
            await delay(5000);
        }

        while (await countUnhealthyTasks() != 0) {
            console.info('Waiting for unhealthy tasks to be RUNNING');
            await delay(5000);
        }

        while (await countUnhealthyInstances() == 0) {
            console.info('Waiting for unhealthy instances');
            await delay(5000);
        }

        while (await countUnhealthyInstances() != 0) {
            console.info('Waiting for unhealthy instances to be HEALTHY');
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
        console.info('Switching traffic route', req);
        const {route: rt} = await this.appmesh.updateRoute(req).promise();
        console.info('Successfully switched traffic route', JSON.stringify(rt));
        return rt;
    }
}