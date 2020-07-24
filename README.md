# Summary

This is a Lambda implementation of AppMesh/ECS/Envoy service deploy

# Setup Instructions

## Clone and Build

First, clone the code and build the function.

```
$ git clone git@github.com:/yizumi/app-mesh-lambda-example
$ yarn install
$ make build
```

The file should be created as `dist/dist.zip`.

## Deploy the function

You can either login to AWS console to upload the zip file after creating the function definition or simply upload using aws-cli.
```
$ aws lambda update-function-code --function-name ${LAMBDA_FUNCTION_NAME} --zip-file fileb://dist/dist.zip`
```

> :warning: **Give the Lambda function enough time to run!**
> It takes some time to create the new App Mesh Virtual Node, create a new ECS Task Definition that hooks to the new Vitual Node, 
> wait for the service stabilize, then finally changing the routing. Give the function enough timeframe (approx 5min) before it times-out.

## AWS Role

Here's a suggested permission policy that you'd like to apply to the Lambda function execution role:
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "servicediscovery:GetInstancesHealthStatus",
                "servicediscovery:ListNamespaces",
                "servicediscovery:ListServices",
                "codepipeline:PutJobSuccessResult",
                "codepipeline:PutJobFailureResult",
                "ecs:CreateTaskSet",
                "ecs:DescribeTaskDefinition",
                "ecs:ListTaskDefinitions",
                "ecs:RegisterTaskDefinition"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "appmesh:CreateVirtualNode",
                "appmesh:DescribeRoute",
                "appmesh:DeleteVirtualNode",
                "appmesh:UpdateRoute"
            ],
            "Resource": [
                "arn:aws:appmesh:${AWS_REGION}:${ACCOUNT_ID}:mesh/${MESH_NAME}/virtualRouter/${VIRTUAL_ROUTER_NAME}/route/${ROUTE_NAME}",
                "arn:aws:appmesh:${AWS_REGION}:${ACCOUNT_ID}:mesh/${MESH_NAME}/virtualNode/${SERVICE_NAME}-*",
                "arn:aws:appmesh:${AWS_REGION}:${ACCOUNT_ID}:mesh/${MESH_NAME}/virtualService/${VIRTUAL_SERVICE_NAME}"
            ]
        },
        {
            "Effect": "Allow",
            "Action": "ecs:ListTasks",
            "Resource": "*",
            "Condition": {
                "ArnEquals": {
                    "ecs:cluster": "arn:aws:ecs:${AWS_REGION}:${ACCOUNT_ID}:cluster/${CLUSTER_NAME}"
                }
            }
        },
        {
            "Effect": "Allow",
            "Action": [
                "iam:PassRole",
                "ecs:CreateService",
                "ecs:DeleteTaskSet",
                "ecs:DescribeServices",
                "ecs:UpdateServicePrimaryTaskSet",
                "ecs:DescribeTasks",
                "appmesh:ListVirtualNodes"
            ],
            "Resource": [
                "arn:aws:ecs:${AWS_REGION}:${ACCOUNT_ID}:task-set/${CLUSTER_NAME}/${ECS_SERVICE_NAME}/*",
                "arn:aws:ecs:${AWS_REGION}:${ACCOUNT_ID}:task/*",
                "arn:aws:ecs:${AWS_REGION}:${ACCOUNT_ID}:container-instance/*",
                "arn:aws:ecs:${AWS_REGION}:${ACCOUNT_ID}:service/${CLUSTER_NAME}/${ECS_SERVICE_NAME}",
                "arn:aws:iam::${ACCOUNT_ID}:role/${TASK_IAM_ROLE}",
                "arn:aws:iam::${ACCOUNT_ID}:role/${TASK_EXECUTION_IAM_ROLE}",
                "arn:aws:appmesh:${AWS_REGION}:${ACCOUNT_ID}:mesh/${MESH_NAME}"
            ]
        }
    ]
}
```

Where:
* `AWS_REGION` - region in which ECS, AppMesh and CloudMap service exist
* `ACCOUNT_ID` - Account ID of the owner of the ECS, AppMesh and CloudMap resources
* `MESH_NAME` - The name of the mesh to which the service belongs as found in AppMesh
* `VIRTUAL_ROUTER_NAME` - Name of the virtual router as found in AppMesh
* `ROUTE_NAME` - Name of the route as found in AppMesh
* `SERVICE_NAME` - Name of the service as registered in CloudMap
* `CLUSTER_NAME` - Name of the ECS cluster
* `ECS_SERVICE_NAME` - Name of the service as appears in ECS
* `TASK_IAM_ROLE` - Name of the IAM Role the ECS Service will use to register the task
* `TASK_EXECUTION_IAM_ROLE` - Name of the IAM Role the ECS Service will use to execute the task

## Setting up the CodePipeline Job
This Lambda function is meant to be invoked by a CodePipeline job.
When calling the function, you need to pass a JSON string containing the information about the service (e.g. App Mesh resources, Cloud Map and ECS Service resources, etc.) as `UserParameters`.

Set the CodePipeline job so that `UserParameters` would appear as follows:
```
{
    "CodePipeline.job": {
        ...
        "data": {
            ...
            "actionConfiguration": {
                ...
                "configuration": {
                    "FunctionName": "grpc-ecs-service-appmesh-deploy",
                    "UserParameters": "{\"meshName\":\"echo\"...}"
                } 
            } 
        }
    }
}
```

`UsersParameters` need to contain a string that conforms with the schema defined in [`src/IAppMeshGrpcServiceProps`](src/IAppMeshGrpcServiceProps.ts).
Here's an example of `UserParameters`:
```
{"key":"echo_server:qa1","meshName":"echo-qa1-mesh","clusterName":"echo-qa1","namespaceName":"echo-qa1.local","serviceName":"echo_server","ecsServiceName":"echo_server","taskDefinitionName":"echo-qa1-echo-server","privateSubnets":["subnet-0123456789abcdef0","subnet-0123456789abcdef1"],"securityGroups":["sg-0123456789abcdef0"],"port":8080,"virtualRouterName":"echo-server-router","routeName":"echo-server-route"}
```
For more detailed examples of `IAppMeshGrpcServiceProps`, you can refer to [`RuntimeServices.ts`](src/RuntimeServices.ts).

For more details about invocation of Lambda functions from CodePipeline, read it in [AWS Documentation](https://docs.aws.amazon.com/ja_jp/lambda/latest/dg/services-codepipeline.html).
