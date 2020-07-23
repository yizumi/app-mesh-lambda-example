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
                "ecs:CreateService",
                "ecs:ListTasks",
                "ecs:DeleteTaskSet",
                "ecs:DescribeServices",
                "ecs:UpdateServicePrimaryTaskSet",
                "ecs:DescribeTasks",
                "appmesh:ListVirtualNodes"
            ],
            "Resource": [
                "arn:aws:ecs:ap-northeast-1:373656256964:task-set/echo*/echo_server*/*",
                "arn:aws:ecs:ap-northeast-1:373656256964:task/*",
                "arn:aws:ecs:ap-northeast-1:373656256964:service/echo_server*",
                "arn:aws:ecs:ap-northeast-1:373656256964:container-instance/*",
                "arn:aws:appmesh:ap-northeast-1:373656256964:mesh/echo*"
            ]
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
                "servicediscovery:GetInstancesHealthStatus",
                "servicediscovery:ListNamespaces",
                "ecs:RegisterTaskDefinition",
                "ecs:DescribeTaskDefinition",
                "ecs:ListTaskDefinitions",
                "ecs:CreateTaskSet"
            ],
            "Resource": "*"
        }
    ]
}
```
