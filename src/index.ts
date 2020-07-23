import AppMeshGrpcService from "./AppMeshGrpcService";
import RuntimeServices from './RuntimeServices';
import CodePipeline, {Job} from "aws-sdk/clients/codepipeline";
import AWS from "aws-sdk";

const codepipeline: CodePipeline = new AWS.CodePipeline();

interface CodePipelineEvent {
    'CodePipeline.job': Job,
}

export const handler = async (event:CodePipelineEvent):Promise<void> => {
    const job = event['CodePipeline.job'];
    if (!job || !job.id) {
        throw Error('No Job definition found');
    }

    try {
        console.info('Event', JSON.stringify(event));
        const userParams:string|undefined = job.data?.actionConfiguration?.configuration?.['UserParameters'];
        const serviceKey = userParams?.match(/SERVICE_KEY=(([^:]+):(.+))$/);
        if (!serviceKey) {
            throw Error('Argument Error: UserParameters does not contain SERVICE_KEY or has an invalid format. ' +
                'Make sure you define UserParameters as "SERVICE_KEY=service_name:env"');
        }

        const props = RuntimeServices.find(k => k.key == serviceKey[1]);
        if (!props) {
            throw Error(`Argument Error: Service Key '${serviceKey[1]}' not found. ` +
                `Available options are: [${RuntimeServices.map(s => s.key).join(',')}]`);
        }

        console.info(`Starting the deploy '${props.key}'`);
        const service = new AppMeshGrpcService(props);
        await service.deploy();
        await codepipeline.putJobSuccessResult({ jobId: job.id }).promise();
    } catch(e) {
        console.error('Error while deploying', JSON.stringify(e));
        await codepipeline.putJobFailureResult({ jobId: job.id, failureDetails: e }).promise();
    }
};
