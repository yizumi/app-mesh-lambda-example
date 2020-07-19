import AppMeshGrpcService from "./AppMeshGrpcService";

export const handler = async (event:any):Promise<any> => {
    const service = new AppMeshGrpcService({
        meshName: 'echo-qa1-mesh',
        clusterName: 'echo-qa1',
        namespaceName: 'echo-qa1.local',
        serviceName: 'echo_server',
        ecsServiceName: 'echo-qa1-app-EchoServerService-QW7DWQ9X8K7V',
        port: 8080,
        virtualRouterName: 'virtual-router',
        routeName: 'route',
    });

    return service.deploy();
};