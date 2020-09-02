import {IAppMeshGrpcServiceProps} from "./IAppMeshGrpcServiceProps";

const RuntimeServices: IAppMeshGrpcServiceProps[] = [
    {
        key: 'echo_server:prod',
        meshName: 'echo-mesh',
        clusterName: 'echo',
        namespaceName: 'echo.local',
        serviceName: 'echo_server',
        ecsServiceName: 'echo_server-20200626124812-service',
        taskDefinitionName: 'echo_server',
        privateSubnets: ['subnet-014bbdb7bd7d197f5', 'subnet-0a6cf45ab183e6057'],
        securityGroups: ['sg-0e9bf54c2994de1b0'],
        port: 8080,
        virtualRouterName: 'virtual-router',
        routeName: 'route',
        virtualNodeSSMParameterName: '/echo/params/APPMESH_VIRTUAL_NODE_NAME',
    },
    {
        key: 'echo_server:qa1',
        meshName: 'echo-qa1-mesh',
        clusterName: 'echo-qa1',
        namespaceName: 'echo-qa1.local',
        serviceName: 'echo_server',
        ecsServiceName: 'echo_server',
        taskDefinitionName: 'echo-qa1-echo-server',
        privateSubnets: ['subnet-0d3fa6a3ab53e535c', 'subnet-0904b30238e86bab5'],
        securityGroups: ['sg-099b7352e0f5525cc'],
        port: 8080,
        virtualRouterName: 'virtual-router',
        routeName: 'route',
        virtualNodeSSMParameterName: '/echo_qa1/params/APPMESH_VIRTUAL_NODE_NAME',
    },
];

export default RuntimeServices;
