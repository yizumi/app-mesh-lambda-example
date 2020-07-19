import AppMeshGrpcService from "./AppMeshGrpcService";
import RuntimeServices from './RuntimeServices';

export const handler = async (event:any):Promise<any> => {
    console.info('Event', JSON.stringify(event));
    const props = RuntimeServices.find(k => k.key == event['runtime_service_name']);
    if (!props) {
        return "Argument Error: Missing valid runtime_service_name";
    }
    console.info(`Starting the deploy '${props.key}'`);
    const service = new AppMeshGrpcService(props);
    return service.deploy();
};