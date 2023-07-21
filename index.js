const { SSMClient, PutParameterCommand, GetParameterCommand } = require("@aws-sdk/client-ssm");
const { CodeBuildClient, BatchGetBuildsCommand } = require("@aws-sdk/client-codebuild");
const axios = require('axios');
const moment = require('moment')

exports.handler = async (event) => {
    try {
        const ssmClient = new SSMClient({ region: 'us-east-1' });
        const buildClient = new CodeBuildClient({ region: 'us-east-1' });

        const event_dict = JSON.parse(event.Records[0].Sns.Message);
        const type = event_dict.detailType;
        const region = event_dict.region;
        // STARTED / SUCCEEDED / FAILED
        const state = event_dict.detail.state;
        const stateChinese = state == "STARTED" ? "開始" : (state == "SUCCEEDED" ? "成功" : "失敗")
        const stateEmoji = state == "STARTED" ? "⚪️" : (state == "SUCCEEDED" ? "✅" : "❌")
        const pipeline = event_dict.detail.pipeline;
        const branchName = pipeline.split('-')[pipeline.split('-').length - 1];
        const repoName = pipeline.replace("-" + branchName, "");
        // Source / Build / Deploy
        const currentStage = event_dict.detail.stage;
        const pipeline_url = `https://${region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline}/view?region=${region}`

        // SSM Storage
        const commitMsgParm = await ssmClient.send(new GetParameterCommand({ Name: '/discord-notify/commitMsg' }));
        const buildNumberParm = await ssmClient.send(new GetParameterCommand({ Name: '/discord-notify/buildNumber' }));


        // 建立Webhook訊息
        let message = undefined;

        console.log(JSON.stringify(event_dict));


        if (type == "CodePipeline Stage Execution State Change") {
            if (currentStage == "Source") {

            } else if (currentStage == "Build") {
                message = {
                    title: `組建${stateChinese}` + ` ${stateEmoji} ${repoName}`,
                    description: `版本${moment().format('yyyyMMDD')}.${buildNumberParm.Parameter.Value} ${commitMsgParm.Parameter.Value}`,
                    color: state === 'SUCCEEDED' ? 65280 : 16711680,
                    footer: {
                        text: `分支: ${branchName == pipeline ? "Unknown" : branchName}`
                    }
                }
            } else if (currentStage == "Deploy") {
                message = {
                    title: `部署${stateChinese}` + ` ✅${stateEmoji} ${repoName}`,
                    description: `版本${moment().format('yyyyMMDD')}.${buildNumberParm.Parameter.Value} ${commitMsgParm.Parameter.Value}`,
                    color: state === 'SUCCEEDED' ? 65280 : 16711680,
                    footer: {
                        text: `分支: ${branchName}`
                    }
                }
            }

            if (state == "FAILED") {
                message.url = pipeline_url
            }
        } else if (type == "CodePipeline Action Execution State Change") {
            if (currentStage == "Source") {
                let commitMsg = event_dict.detail["execution-result"]["external-execution-summary"];
                const provider = JSON.parse(commitMsg).ProviderType;
                if (provider != undefined) {
                    commitMsg = JSON.parse(commitMsg).CommitMessage;
                }
                const putParameterResults = await Promise.all(
                    ssmClient.send(new PutParameterCommand({
                        Name: '/discord-notify/commitMsg',
                        Value: commitMsg,
                        Type: 'String',
                        Overwrite: true,
                    }))
                );
                return putParameterResults;
            } else if (currentStage == "Build") {
                const buildId = event_dict.detail["execution-result"]["external-execution-id"];
                const command = new BatchGetBuildsCommand({ ids: [buildId] });
                const response = await buildClient.send(command);

                const buildNumber = response.builds[0]?.buildNumber;
                console.log("build number: " + buildNumber)
                const putParameterResults = await Promise.all(
                    ssmClient.send(new PutParameterCommand({
                        Name: '/discord-notify/buildNumber',
                        Value: `${buildNumber}`,
                        Type: 'String',
                        Overwrite: true,
                    }))
                );
            }
        }


        // 發送 Discord Webhook 通知
        const webhookURL = 'https://discord.com/api/webhooks/1101523329900367934/oSP7rYI2FT0QJRl8qRECn12n8gqVwKwwm1rR5QOhovcZf7gZdpWQqGlCdw-r4vp-gRpU';

        await axios.post(webhookURL, {
            username: "Rhythm Game Map",
            avatar_url: "",
            content: "",
            embeds: [
                message
            ]
        });

        return {
            statusCode: 200,
            body: 'Discord Webhook sent successfully.',
        };
    } catch (error) {
        return {
            statusCode: 500,
            body: 'Error sending Discord Webhook.',
            message: error.stack
        };
    }
};