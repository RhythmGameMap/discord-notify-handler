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
    // Source / Build / Deploy
    const currentStage = event_dict.detail.stage;
    const pipeline_url = `https://${region}.console.aws.amazon.com/codesuite/codepipeline/pipelines/${pipeline}/view?region=${region}`
    
    // SSM Storage
    const repoNameParam = await ssmClient.send(new GetParameterCommand({ Name: '/discord-notify/RepoName' }));
    const branchNameParam = await ssmClient.send(new GetParameterCommand({ Name: '/discord-notify/BranchName' }));
    const commitMsgParm = await ssmClient.send(new GetParameterCommand({ Name: '/discord-notify/commitMsg' }));
    const buildNumberParm = await ssmClient.send(new GetParameterCommand({ Name: '/discord-notify/buildNumber' }));
    
    
    // 建立Webhook訊息
    let message = undefined;

    console.log(event_dict);


    if(type == "CodePipeline Stage Execution State Change") {
        if(currentStage == "Source") {
            const branchName = event_dict.additionalAttributes.sourceActions[0].sourceActionVariables.BranchName
            const repoName = event_dict.additionalAttributes.sourceActions[0].sourceActionVariables.RepositoryName;
    
            // 建立參數
            const params = [
              {
                Name: '/discord-notify/RepoName',
                Value: repoName,
                Type: 'String',
                Overwrite: true,
              },
              {
                Name: '/discord-notify/BranchName',
                Value: branchName,
                Type: 'String',
                Overwrite: true,
              },
            ];
    
            const putParameterResults = await Promise.all(
                params.map(param =>
                  ssmClient.send(new PutParameterCommand({
                    Name: param.Name,
                    Value: param.Value,
                    Type: param.Type,
                    Overwrite: param.Overwrite,
                  }))
                )
              );
            return putParameterResults;
        } else if(currentStage == "Build") {
            message = { 
                title: `組建${stateChinese}` + ` ${stateEmoji} ${repoNameParam.Parameter.Value}`,
                description: `版本${moment().format('yyyyMMDD')}.${buildNumberParm.Parameter.Value} ${commitMsgParm.Parameter.Value}`,
                color: state === 'SUCCEEDED' ? 65280 : 16711680,
                footer: { 
                        text:`分支: ${branchNameParam.Parameter.Value}`
                    }
                }
        } else if(currentStage == "Deploy") {
            message = { 
                title: `部署${stateChinese}` + ` ✅${stateEmoji} ${repoNameParam.Parameter.Value}`,
                description: `版本${moment().format('yyyyMMDD')}.${buildNumberParm.Parameter.Value} ${commitMsgParm.Parameter.Value}`,
                color: state === 'SUCCEEDED' ? 65280 : 16711680,
                footer: { 
                        text:`分支: ${branchNameParam.Parameter.Value}`
                    }
                }
        }

        if (state == "FAILED") {
            message.url = pipeline_url
        }
    } else if(type == "CodePipeline Action Execution State Change") {
        if(currentStage == "Source") {
            const commitMsg = event_dict.detail["execution-result"]["external-execution-summary"];
            const putParameterResults = await Promise.all(
                ssmClient.send(new PutParameterCommand({
                    Name: '/discord-notify/commitMsg',
                    Value: commitMsg,
                    Type: 'String',
                    Overwrite: true,
                  }))
              );
            return putParameterResults;
        } else if(currentStage == "Build") {
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