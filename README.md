# Summary

This is a Lambda implementation of AppMesh/ECS/Envoy service deploy

# Prerequisites

## AWS Role

Following roles are required:
```
{
    "Version": "2012-10-17",
    "Statement": [
        {
            "Effect": "Allow",
            "Action": [
                "appmesh:CreateVirtualNode",
                "appmesh:UpdateRoute",
                "appmesh:DescribeRoute",
                "appmesh:DeleteVirtualNode"
            ],
            "Resource": [
                "arn:aws:appmesh:ap-northeast-1:373656256964:mesh/echo*/virtualRouter/virtual-router/route/route",
                "arn:aws:appmesh:ap-northeast-1:373656256964:mesh/echo*/virtualNode/echo_server*",
                "arn:aws:appmesh:ap-northeast-1:373656256964:mesh/echo*/virtualService/echo_server"
            ]
        },
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
            "Action": "ecs:ListTasks",
            "Resource": "*",
            "Condition": {
                "ArnEquals": {
                    "ecs:cluster": "arn:aws:ecs:ap-northeast-1:373656256964:cluster/echo*"
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
                "arn:aws:ecs:ap-northeast-1:373656256964:task-set/echo*/echo_server*/*",
                "arn:aws:ecs:ap-northeast-1:373656256964:task/*",
                "arn:aws:ecs:ap-northeast-1:373656256964:container-instance/*",
                "arn:aws:ecs:ap-northeast-1:373656256964:service/echo*/echo_server",
                "arn:aws:iam::373656256964:role/echo-qa1-app-TaskIamRole-1AP99XDSOWUMW",
                "arn:aws:iam::373656256964:role/echo-qa1-app-TaskExecutionIamRole-BL3PANTLKKMS",
                "arn:aws:appmesh:ap-northeast-1:373656256964:mesh/echo*"
            ]
        }
    ]
}
```
