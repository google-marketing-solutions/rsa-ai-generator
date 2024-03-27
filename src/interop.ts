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

import { Config } from './config';

export function getErrorFromResponse(responseText: string) {
  let errorMsg = '';
  try {
    const resJson = JSON.parse(responseText);
    /* Example:
      [{
        "error": {
          "code": 403,
          "message": "The caller does not have permission",
          "status": "PERMISSION_DENIED",
          "details": [
            {
              "@type": "type.googleapis.com/google.ads.googleads.v15.errors.GoogleAdsFailure",
              "errors": [
                {
                  "errorCode": {
                    "authorizationError": "DEVELOPER_TOKEN_PROHIBITED"
                  },
                  "message": "Developer token is not allowed with project 'xxxxxx'."
                }
              ],
              "requestId": "AoGJHSjsd-xxxxx"
            }
          ]
        }
      }
      ]
     */
    const data = resJson && resJson.length ? resJson[0] : resJson;
    if (data?.error) {
      errorMsg = data.error.message;
      if (data.error.details && data.error.details.length) {
        errorMsg = errorMsg + '. ' + data.error.details[0].errors?.[0]?.message;
      }
    }
  } catch {
    // skip
    Logger.log(
      'Failed to parse error from http response, original raw response: ' +
        responseText
    );
  }
  return errorMsg;
}

export function fetchJson(url: string, params: any, retryNum?: number): any {
  if (!retryNum) retryNum = 0;
  if (!params.contentType) {
    params.contentType = 'application/json';
  }
  // TODO: check 'logging' setting
  // if (this.logging) {
  //   Logger.log(
  //     `Request to ${this.url}\n: ${JSON.stringify(request)}`
  //   );
  // }
  // NOTE: UrlFetchApp has a limit for response size of 50MB per call
  //  https://developers.google.com/apps-script/guides/services/quotas#current_limitations
  // (52428800)
  const request = Object.assign({}, params);
  if (
    params.method?.toLocaleUpperCase() === 'POST' &&
    params.payload &&
    typeof params.payload !== 'string'
  ) {
    request.payload = JSON.stringify(params.payload);
  }
  const response = UrlFetchApp.fetch(url, request);
  const code = response.getResponseCode();
  if (code === 429) {
    Logger.log(
      `Waiting ${
        Number(Config.vertexAi.quotaLimitDelay) / 1000
      }s as API quota limit has been reached...`
    );
    Utilities.sleep(Config.vertexAi.quotaLimitDelay);
    return fetchJson(url, params);
  }
  const responseText = response.getContentText();
  // TODO: check 'logging' setting
  Logger.log(
    `Code: ${code}\nResponse: (length=${responseText.length})\n ${responseText}`
  );
  if (code === 403) {
    const errorMsg = getErrorFromResponse(responseText);
    throw new Error(`Permission denined` + (errorMsg ? ': ' + errorMsg : ''));
  }
  if (code === 502 || code === 504 || code === 504) {
    // 502 - Bad Gateway
    // 503 - Service Unavailable
    // 504 - Gateway Timeout
    Utilities.sleep(Config.network.retryDelay);
    retryNum += 1;
    if (retryNum >= Config.network.maxRetryCount) {
      throw new Error('Max retry attempt count exceeded');
    }
    return fetchJson(url, params, retryNum);
  }
  if (code !== 200) {
    let errorMsg = getErrorFromResponse(responseText);
    errorMsg =
      errorMsg || `API call has failed (url: ${url}) with code ${code}`;
    throw new Error(errorMsg);
  }
  try {
    return JSON.parse(responseText);
  } catch (e) {
    if (responseText.length >= 50 * 1024 * 1024) {
      throw new Error(
        `API response is too large (${responseText.length}) and was truncated, as so it could not be passed. Please contact the developers. Original error: ${e}`
      );
    }
    throw new Error(`An error ocurred on API response parsing: ${e}`);
  }
}
