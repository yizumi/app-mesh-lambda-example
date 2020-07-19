import AppMeshGrpcService from "./AppMeshGrpcService";

export const handler = async (event:any):Promise<any> => {
    const service = new AppMeshGrpcService({
        meshName: 'echo-mesh',
        clusterName: 'echo',
        namespaceName: 'echo.local',
        serviceName: 'echo_server',
        port: 8080,
        virtualRouterName: 'virtual-router',
        routeName: 'route',
    });

    return service.deploy();
};