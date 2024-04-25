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

import { Config, IConfigReader, SETTINGS } from './config';
import { fetchJson } from './interop';

export interface GoogleAdsClientOptions {
  devToken?: string;
  mccId?: string;
  apiVersion?: string;
}

type InternalAdsAppType = {
  search: (request: string, opts: any) => any;
};
declare const InternalAdsApp: InternalAdsAppType;

export class GoogleAdsClient {
  configReader: IConfigReader;
  apiVersion: string;
  devToken: string;
  mccId: string;
  endpoint: string;
  static execHook: (
    url: string,
    request: any,
    customerId: string,
    apiVersion: string
  ) => any | undefined;

  /**
   * @constructor
   * @param {Object} options
   * @param options.apiVersion
   * @param options.devToken
   * @param options.mccId
   */
  constructor(options: GoogleAdsClientOptions, configReader: IConfigReader) {
    options = options || {};
    this.configReader = configReader;
    this.apiVersion =
      options.apiVersion ||
      configReader.getValue(
        SETTINGS.ADS_API_VERSION,
        Config.adsApi.api_versions
      );
    this.devToken = options.devToken?.toString() || '';
    this.mccId = options.mccId?.toString() || '';
    this.endpoint = `https://googleads.googleapis.com/${this.apiVersion}/`;
    if (configReader.getValue(SETTINGS.ADS_INTERNAL_PROXY)) {
      Logger.log('WARN: Using internal Google Ads client (InternalAdsApp)');
      GoogleAdsClient.execHook = (url, request, customerId, apiVersion) => {
        request.payload.customer_id = (customerId || this.mccId).toString();
        Logger.log(
          `Sending GoogleAds request: ${JSON.stringify(request.payload)}`
        );
        const response = InternalAdsApp.search(
          JSON.stringify(request.payload),
          { version: apiVersion }
        );
        return response;
      };
    }
  }

  sendApiRequest(url: string, request: any, customerId: string): any {
    if (GoogleAdsClient.execHook) {
      const responseText = GoogleAdsClient.execHook(
        url,
        request,
        customerId,
        this.apiVersion
      );
      return JSON.parse(responseText);
    }
    return fetchJson(url, request);
  }

  expandCustomers(customerId: string) {
    const query = `SELECT
        customer_client.id
      FROM customer_client
      WHERE
        customer_client.status = "ENABLED" AND
        customer_client.manager = False`;
    const rows = this.execQuery(query, customerId);
    const cids = rows.map(row => row.customerClient.id);
    Logger.log(
      `Customer ${customerId} was expanded to these leaf customers: ${cids.join(
        ','
      )}`
    );
    return cids;
  }

  execQuery(query: string, customerId: string): any[] {
    Logger.log(`Executing GAQL query: ${query}`);
    const OAUTH_TOKEN = ScriptApp.getOAuthToken();
    const url = `${this.endpoint}customers/${customerId}/googleAds:search`;
    const request: any = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OAUTH_TOKEN,
        'developer-token': this.devToken,
        'Content-Type': 'application/json',
      },
      contentType: 'application/json',
      payload: {
        //NOTE: by default pageSize=10000, might be configurable in the future
        query: query,
      },
      muteHttpExceptions: true, // Set to true for full exceptions in logs
    };
    if (this.mccId) {
      request.headers['login-customer-id'] = this.mccId;
    }
    let results;
    do {
      const resJson = this.sendApiRequest(url, request, customerId);
      const data = resJson && resJson.length ? resJson[0] : resJson;
      if (!data) {
        Logger.log(`WARNING: empty response recieved for cid=${customerId}`);
      }
      if (data?.error) {
        throw new Error(data.error.message);
      }
      if (data?.results) {
        if (!results) {
          results = data.results;
        } else {
          results = results.concat(data.results);
        }
      }
      if (data?.nextPageToken) {
        request.payload.pageToken = data.nextPageToken;
        continue;
      }
      break;
      // eslint-disable-next-line no-constant-condition
    } while (true);

    return results || [];
  }
}
