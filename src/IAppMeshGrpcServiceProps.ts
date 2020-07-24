/**
 * Describes a Grpc hosted on ECS using AppMesh envoy side-car
 */
export interface IAppMeshGrpcServiceProps {
    /** Unique identifier that indicates this set */
    key?: string;
    /** Name of the mesh in AppMesh */
    meshName: string;
    /** Name of the virtual router as found in AppMesh */
    virtualRouterName: string;
    /** Name of the route as found in AppMesh */
    routeName: string;
    /** Port Number to which the gRPC service listens */
    port: number;
    /** Name of the namespace as registered in CloudMap */
    namespaceName: string;
    /** Name of the service as registered in CloudMap. Also used as a prefix for VirtualNode's name. */
    serviceName: string;
    /** Name of the tasks and services run in ECS */
    clusterName: string;
    /** Name of the service as appears in ECS */
    ecsServiceName: string;
    /** Name of the task definition on ECS */
    taskDefinitionName: string;
    /** Names of private subnets to which this service will be deployed when running on ECS */
    privateSubnets: string[];
    /** Names of security groups to which this service will be running with on ECS */
    securityGroups: string[];
}
