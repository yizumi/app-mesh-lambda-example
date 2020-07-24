import AppMeshGrpcService from "./AppMeshGrpcService";
import RuntimeServices from './RuntimeServices';
import CodePipeline, {Job} from "aws-sdk/clients/codepipeline";
import AWS from "aws-sdk";
import {IAppMeshGrpcServiceProps} from "./IAppMeshGrpcServiceProps";

const codepipeline: CodePipeline = new AWS.CodePipeline();

interface CodePipelineEvent {
    'CodePipeline.job': Job,
}

function userParamsToProps(userParams:string): IAppMeshGrpcServiceProps {
    const serviceKey = userParams?.match(/SERVICE_KEY=(([^:]+):(.+))$/);
    if (serviceKey && serviceKey[1]) {
        const props = RuntimeServices.find(k => k.key == serviceKey[1]);
        if (!props) {
            throw Error(`Argument Error: Service Key '${serviceKey[1]}' not found. ` +
                `Available options are: [${RuntimeServices.map(s => s.key).join(',')}]`);
        }
        return props;
    } else {
        try {
            return JSON.parse(userParams) as IAppMeshGrpcServiceProps;
        } catch(e) {
            throw Error(`Error while parsing JSON string: '${JSON.stringify({ error: e, userParameters: userParams})}'`);
        }
    }
}

export const handler = async (event:CodePipelineEvent):Promise<void> => {
    const job = event['CodePipeline.job'];
    if (!job || !job.id) {
        throw Error('No Job definition found');
    }

    try {
        console.info('Event', JSON.stringify(event));
        const userParams:string|undefined = job.data?.actionConfiguration?.configuration?.['UserParameters'];
        if (!userParams) {
            throw Error('Argument Error: Missing UserParameters. Check the CodePipeline action settings. ' +
                'Make sure you have User Parameters set that follows `IAppMeshGrpcServiceProps` interface');
        }

        const props = userParamsToProps(userParams);
        const service = new AppMeshGrpcService(props);
        await service.deploy();
        await codepipeline.putJobSuccessResult({ jobId: job.id }).promise();
    } catch(e) {
        console.error('Error while deploying', JSON.stringify(e));
        await codepipeline.putJobFailureResult({ jobId: job.id, failureDetails: e }).promise();
    }
};
