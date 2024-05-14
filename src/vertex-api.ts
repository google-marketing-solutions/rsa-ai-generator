/**
 * Copyright 2023-2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *       http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import {
  SETTINGS,
  Config,
  BlockingThreshold,
  SafetyCategory,
  IConfigReader,
} from './config';
import { fetchJson } from './interop';

export class GeminiVertexApi {
  projectId: string;
  configReader: IConfigReader;
  url: string;
  modelParams: any;
  logging: boolean;
  safetySettings: { category: SafetyCategory; threshold: BlockingThreshold }[];

  constructor(projectId: string, configReader: IConfigReader) {
    this.projectId = projectId;
    this.configReader = configReader;
    const gcpRegion =
      this.configReader.getValue(SETTINGS.CLOUD_PROJECT_REGION) ||
      Config.vertexAi.location ||
      'us-central1';
    const modelName =
      this.configReader.getValue(SETTINGS.LLM_Name) ||
      Config.vertexAi.modelName ||
      'gemini-pro';
    this.url = `https://${gcpRegion}-aiplatform.googleapis.com/v1/projects/${projectId}/locations/${gcpRegion}/publishers/google/models/${modelName}:streamGenerateContent`;

    const safetySettings = Object.assign({}, Config.vertexAi.safetySettings);
    for (const category of Object.keys(Config.vertexAi.safetySettings)) {
      const threshold = <BlockingThreshold>(
        this.configReader.getValue('LLM_SAFETY_' + category)
      );
      if (threshold) {
        // safety category has an overriden threshold in Configuration
        safetySettings[<SafetyCategory>category] = threshold;
      }
    }
    this.safetySettings = [];
    for (const pair of Object.entries(safetySettings)) {
      this.safetySettings.push({
        category: <SafetyCategory>pair[0],
        threshold: <BlockingThreshold>pair[1],
      });
    }

    // set modelParams
    type keyType = keyof typeof Config.vertexAi.modelParams;
    const modelParams: Record<keyType, any> = Object.assign(
      {},
      Config.vertexAi.modelParams
    );
    //  - overwrite modelParams from Configuration
    for (const category of Object.keys(modelParams)) {
      const value = this.configReader.getValue('LLM_Params_' + category);
      if (value) {
        modelParams[<keyType>category] = value;
      }
    }
    this.modelParams = Object.assign(modelParams, {
      candidateCount: 1,
      //response_mime_type: 'application/json',
    });

    this.logging = false;
  }

  /**
   * @param {String} prompt
   * @param {Array} history
   */
  predict(prompt: string, history?: any[]) {
    history = history || [];
    history.push({
      role: 'user',
      parts: [{ text: prompt }],
    });
    const data = {
      contents: history.slice(0, history.length),
      // see https://ai.google.dev/docs/safety_setting_gemini
      safetySettings: this.safetySettings,
      generationConfig: this.modelParams,
    };
    if (this.logging) {
      Logger.log(`GeminiApi: sending payload: ${JSON.stringify(data)}`);
    }

    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${ScriptApp.getOAuthToken()}`,
      },
      payload: data,
      muteHttpExceptions: true,
    };

    const res = fetchJson(this.url, request);
    if (res.length) {
      // streamGenerateContent returns an array of response that should be merged into one
      let reply = '';
      for (const resItem of res) {
        const text = this._parseResponse(resItem, prompt);
        if (text) {
          reply += text;
        }
      }
      // TODO: we might want to retry the request if the last part of response has finishReason != STOP (e.g OTHER)
      history.push({
        role: 'model',
        parts: [
          {
            text: reply,
          },
        ],
      });
      if (this.logging) {
        Logger.log(`GeminiApi: parsed response: ${reply}`);
      }
      return reply;
    } else {
      throw new Error(`Uknown response from the API: ${JSON.stringify(res)}`);
    }
  }

  _parseResponse(res: any, prompt: string) {
    if (res.promptFeedback && res.promptFeedback.blockReason) {
      throw new Error(
        `Request was blocked as it triggered API safety filters. Reason: ${res.promptFeedback.blockReason}.\n Original prompt: ${prompt}`
      );
    }
    if (res.candidates) {
      if (res.candidates[0].content) {
        const result = res.candidates[0].content;
        if (!result.parts || !result.parts.length) {
          return '';
        }
        return result.parts[0].text || '';
      } else {
        // TODO: analyze res.candidates[0].finishReason;
        Logger.log(
          `Received empty response from API. Prompt: ${prompt}. Full response: ${JSON.stringify(
            res
          )}`
        );
        return '';
      }
    }
    return '';
  }
}
