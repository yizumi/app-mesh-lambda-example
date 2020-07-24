# Summary

This is a Lambda implementation of AppMesh/ECS/Envoy service deploy

# Prerequisites

## Invoking the function from CodePipeline
This lambda function is meant to be invoked by a CodePipeline job.
When calling the function, you need to pass a JSON string containing the information about the service (e.g. App Mesh resources, Cloud Map and ECS Service resources, etc.) as `UserParameters`. This JSON needs to conform with the schema defined in `IAppMeshGrpcServiceProps`.

For example:
```
{
    "CodePipeline.job": {
        ...
        "data": {
            ...
            "actionConfiguration": {
                ...
                "configuration": {
                    ...
                    "UserParameters": "{\"meshName\":\"echo\"...}"
                } 
            } 
        }
    }
}
```

For the full definition of the interface, please refer to `src/IAppMeshGrpcServiceProps.ts`.

## AWS Role

Following are the role permissions required to deploy:
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "servicediscovery:ListServices",
                "codepipeline:PutJobFailureResult",
                "codepipeline:PutJobSuccessResult",
                "ecs:RegisterTaskDefinition",
                "servicediscovery:GetInstancesHealthStatus",
                "servicediscovery:ListNamespaces",
                "ecs:ListTaskDefinitions",
                "ecs:DescribeTaskDefinition",
                "ecs:CreateTaskSet"
            ],
            "Resource": "*"
        },
        {
            "Effect": "Allow",
            "Action": [
                "appmesh:CreateVirtualNode",
                "appmesh:UpdateRoute",
                "appmesh:DescribeRoute",
                "appmesh:DeleteVirtualNode"
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
