/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * Copyright 2023 Google LLC
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

export const app = null;

const Config = {
  sheets: {
    Configuration: 'Configuration',
  },
  settingsNames: {
    CID: 'CID',
    MCC: 'MCC',
    ADS_DEV_TOKEN: 'ADS_DEV_TOKEN',
    CLOUD_PROJECT_ID: 'CLOUD_PROJECT_ID',
    CLOUD_PROJECT_REGION: 'CLOUD_PROJECT_REGION',
    CUSTOMER_NAME: 'CUSTOMER_NAME',
    LLM_temperature: 'LLM_temperature',
    LLM_topK: 'LLM_topK',
    LLM_topP: 'LLM_topP',
    LLM_Prompt_Headlines: 'LLM_Prompt_Headlines',
    LLM_Prompt_Headlines_Shorten: 'LLM_Prompt_Headlines_Shorten',
    LLM_Prompt_Descriptions: 'LLM_Prompt_Descriptions',
    ADSEDITOR_add_long_headlines: 'ADSEDITOR_add_long_headlines',
    ADSEDITOR_add_long_descriptions: 'ADSEDITOR_add_long_descriptions',
    ADSEDITOR_add_generic_headlines: 'ADSEDITOR_add_generic_headlines',
    ADSEDITOR_add_generic_descriptions: 'ADSEDITOR_add_generic_descriptions',
    LOGGING: 'LOGGING',
  },
  network: {
    maxRetryCount: 100,
    retryDelay: 100,
  },
  // settings for VertexAi
  vertexAi: {
    endpoint: 'aiplatform.googleapis.com',
    location: 'us-central1',
    maxRetries: 3,
    quotaLimitDelay: 30 * 1000, // 30s
    modelName: 'gemini-pro',
    // model default params (they are taken from Python official package (vertextai.language_models))
    modelParams: {
      temperature: undefined, // temperature: Controls the randomness of predictions. Range: [0, 1].
      maxOutputTokens: 8192, // Max length of the output text in tokens.
      topK: undefined, // The number of highest probability vocabulary tokens to keep for top-k-filtering.
      topP: undefined, // The cumulative probability of parameter highest probability vocabulary tokens to keep for nucleus sampling. Range: [0, 1].
    },
    // https://cloud.google.com/vertex-ai/docs/generative-ai/learn/responsible-ai#limitations
    maxRequestLength: 8 * 1024,
  },
  // settings for Ads API
  adsApi: {
    api_versions: 'v15',
  },
  ads: {
    rsa_headline_max_length: 30,
    rsa_headline_min_length: 5,
    rsa_description_max_length: 90,
    rsa_description_min_length: 10,
  },
};

function fetchJson(url: string, params: any, retryNum?: number) {
  if (!retryNum) retryNum = 0;
  if (!params.contentType) {
    params.contentType = 'application/json';
  }
  const response = UrlFetchApp.fetch(url, params);
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
  const response_text = response.getContentText();
  Logger.log('Code: ' + code + '\nResponse:\n' + response_text);
  if (code === 403) {
    throw new Error(`Permission denined`);
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
    let error_msg;
    try {
      const res_json = JSON.parse(response_text);
      const data = res_json && res_json.length ? res_json[0] : null;
      if (data.error) {
        error_msg = data.error.message;
      }
    } catch {
      // skip
    }
    error_msg =
      error_msg || `API call has failed (url: ${url}) with code ${code}`;
    throw new Error(error_msg);
  }
  return JSON.parse(response_text);
}

class ConfigReader {
  static getValue(name: string) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
      Config.sheets.Configuration
    );
    if (!sheet) return '';
    const values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
    for (const row of values) {
      if (row[0].toLowerCase() === name.toLowerCase()) {
        return row[1];
      }
    }
    return '';
  }
}

export interface GoogleAdsClientOptions {
  devToken?: string;
  mccId?: string;
  apiVersion?: string;
}
export class GoogleAdsClient {
  devToken: string;
  mccId: string;
  endpoint: string;
  /**
   * @constructor
   * @param {Object} options
   * @param options.apiVersion
   * @param options.devToken
   * @param options.mccId
   */
  constructor(options?: GoogleAdsClientOptions) {
    options = options || {};
    const apiVersion = options.apiVersion || Config.adsApi.api_versions;
    this.devToken = options.devToken?.toString() || '';
    this.mccId = options.mccId?.toString() || '';
    this.endpoint = `https://googleads.googleapis.com/${apiVersion}/`;
  }

  async expandCustomers(customerId: string) {
    const query = `SELECT
        customer_client.id
      FROM customer_client
      WHERE
        customer_client.status = "ENABLED" AND
        customer_client.manager = False`;
    const rows = await this.execQuery(query, customerId);
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
    const url =
      this.endpoint + `customers/${customerId}/googleAds:searchStream`;
    const request: any = {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + OAUTH_TOKEN,
        'developer-token': this.devToken,
        'Content-Type': 'application/json',
      },
      contentType: 'application/json',
      payload: JSON.stringify({
        query: query,
      }),
      muteHttpExceptions: true, // Set to true for full exceptions in logs
    };
    if (this.mccId) {
      request.headers['login-customer-id'] = this.mccId;
    }
    const res_json = fetchJson(url, request);
    // var response = UrlFetchApp.fetch(url, request);
    // Logger.log(response.getContentText());
    // const res_json = JSON.parse(response.getContentText());
    const data = res_json && res_json.length ? res_json[0] : null;
    if (data && data.error) {
      throw new Error(data.error.message);
    }
    if (!res_json.length) {
      Logger.log(`WARNING: empty response recieved for cid=${customerId}`);
    }
    return res_json && res_json.length ? res_json[0].results : [];
  }
}

export async function fetch_keywords() {
  const mccId = ConfigReader.getValue(Config.settingsNames.MCC);
  const seedCustomerId =
    ConfigReader.getValue(Config.settingsNames.CID) || mccId;
  if (!seedCustomerId) {
    SpreadsheetApp.getUi().alert(
      'Please specify a customer id in the CID and/or MCC fields on the Configuration sheet'
    );
    return;
  }
  const devToken = ConfigReader.getValue(Config.settingsNames.ADS_DEV_TOKEN);
  if (!devToken) {
    SpreadsheetApp.getUi().alert(
      'Please specify a developer token on the Configuration sheet'
    );
    return;
  }
  const client = new GoogleAdsClient({
    devToken: devToken,
    mccId: mccId,
  });

  const customerIds = await client.expandCustomers(seedCustomerId);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(
    `keywords - ${seedCustomerId} - ${new Date().toISOString()}`,
    0
  );
  let headers;
  let startRow = 2;
  for (const cid of customerIds) {
    const kws = getAllKeywords(client, cid);
    if (!kws || kws.length === 0) {
      Logger.log(`No keywords for customer ${cid} were found`);
      continue;
    }

    if (!headers) {
      headers = Object.keys(kws[0]);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet
        .getRange(1, headers.length + 1, 1, 2)
        .setValues([['headlines', 'descriptions']]);
    }
    const values = convertObjectsToArrays(kws);
    sheet.getRange(startRow, 1, kws.length, headers.length).setValues(values);
    startRow += kws.length;
  }
}

/**
 * Convert array of objects into a 2-dimentinal array for spreadsheet
 * @param {Array<AdGroup>} arrayOfObjects
 * @return {String[][]}
 */
function convertObjectsToArrays(arrayOfObjects: AdGroup[]) {
  return arrayOfObjects.map(o => {
    return [
      o.customer_id,
      o.customer_name,
      o.campaign_id,
      o.campaign_name,
      o.adgroup_id,
      o.adgroup_name,
      o.keywords_array?.join('\n'),
      o.url,
      //o.urls && o.urls.length ? o.urls[0] : '',
      o.ignore,
    ];
  });
}

/**
 * Fetch all keywords for specific customer
 * @param {GoogleAdsClient} client
 * @param {String} customerId
 * @returns {Array<AdGroup>}
 */
function getAllKeywords(
  client: GoogleAdsClient,
  customerId: string
): AdGroup[] {
  const query_kw = `SELECT
    customer.id,
    customer.descriptive_name,
    campaign.id,
    campaign.name,
    ad_group.id,
    ad_group.name,
    ad_group_criterion.keyword.text,
    metrics.clicks
  FROM keyword_view
  WHERE ad_group.type = SEARCH_STANDARD
    AND campaign.status = ENABLED
    AND ad_group_criterion.status = ENABLED
    AND metrics.clicks > 0
  `;

  const query_ads = `SELECT
    ad_group.id,
    ad_group_ad.ad.final_urls
  FROM ad_group_ad`;

  let adgroup_id;
  const adgroup_urls: Record<number, string[]> = {};
  const rows_ads = client.execQuery(query_ads, customerId);
  if (rows_ads && rows_ads.length) {
    for (const row of rows_ads) {
      const urls = row.adGroupAd.ad.finalUrls;
      if (urls && urls.length) {
        if (row.adGroup.id !== adgroup_id) {
          adgroup_urls[row.adGroup.id] = urls;
        } else {
          adgroup_urls[row.adGroup.id].push(...urls);
        }
      }
      adgroup_id = row.adGroup.id;
    }
  }

  const rows = client.execQuery(query_kw, customerId);
  if (!rows || !rows.length) {
    return [];
  }

  adgroup_id = undefined;
  const results: AdGroup[] = [];
  let current: AdGroup | undefined = undefined;
  for (const row of rows) {
    // we'll group keywords by adgroup
    if (row.adGroup.id !== adgroup_id) {
      // current adgroup has changed (including the case of the first row)
      current = {
        customer_id: row.customer.id,
        customer_name: row.customer.descriptiveName,
        campaign_id: row.campaign.id,
        campaign_name: row.campaign.name,
        adgroup_id: row.adGroup.id,
        adgroup_name: row.adGroup.name,
        keywords_array: [row.adGroupCriterion.keyword.text],
        //urls: adgroup_urls[row.adGroup.id],
        url: adgroup_urls[row.adGroup.id]
          ? adgroup_urls[row.adGroup.id][0]
          : '',
        ignore: false,
      };
      results.push(current);
    } else {
      // same adgroup as before
      current!.keywords_array!.push(row.adGroupCriterion.keyword.text);
    }
    adgroup_id = row.adGroup.id;
  }

  return results;
}

/**
 * @class AdGroup
 * @property {String} customer_id
 * @property {String} customer_name
 * @property {Number} campaign_id
 * @property {String} campaign_name
 * @property {Number} adgroup_id
 * @property {String} adgroup_name
 * @property {Array} keywords
 * @property {String} url
 * @property {Boolean} ignore
 */
interface AdGroup {
  customer_id: string;
  customer_name: string;
  campaign_id: string;
  campaign_name: string;
  adgroup_id: number;
  adgroup_name: string;
  keywords_array?: string[];
  keywords?: string;
  //urls: string[];
  url: string;
  ignore: boolean;
  headlines?: string;
  all_headlines?: string[];
  descriptions?: string;
}

/**
 * Root function for calling from the UI menu.
 * Goes through all keywords (they should be fetched first via fetch_keywords) and generates headlines via PaLM API.
 */
export function generate_rsa(rowToProcess?: number) {
  const project_id = ConfigReader.getValue(
    Config.settingsNames.CLOUD_PROJECT_ID
  );
  const gcp_region = ConfigReader.getValue(
    Config.settingsNames.CLOUD_PROJECT_REGION
  );
  if (!project_id) {
    SpreadsheetApp.getUi().alert(
      'Please provide a GCP project id on the Configuration sheet (you should also enable Vertex API in that proejct)'
    );
    return;
  }

  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet.getName().toLocaleLowerCase().startsWith('keywords')) {
    console.log(sheet.getName());
    SpreadsheetApp.getUi().alert(
      'Please switch to a sheet with keywords (it should be titled "keywords")'
    );
    return;
  }
  const customerName = ConfigReader.getValue(
    Config.settingsNames.CUSTOMER_NAME
  );
  if (!customerName) {
    SpreadsheetApp.getUi().alert(
      'Please specify a customer name on the Configuration sheet'
    );
    return;
  }

  //const api = new PalmChatApi(project_id, gcp_region);
  const api = new GeminiVertexApi(project_id, gcp_region);
  api.logging =
    ConfigReader.getValue(Config.settingsNames.LOGGING)
      .toString()
      .toLocaleUpperCase() === 'TRUE';
  const predictor = new Predictor(api, customerName);

  let rowNo = rowToProcess || 2;
  const rowNums = rowToProcess ? 1 : sheet.getLastRow() - 1;
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(rowNo, 1, rowNums, lastCol - 2).getValues();
  Logger.log(
    `Generating headlines for "${customerName}" for all ${values.length} adgroups`
  );

  // A/1: customer_id, B/2: customer_name, C/3:campaign_id, D/4: campaign_name, E/5: adgroup_id, F/6: adgroup_name, G/7: keywords, H/8: urls, I/9: ignore, J/10: headlines, K/11: descriptions
  const columns = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const COL_Headlines = columns.indexOf('headlines') + 1;
  const COL_Descriptions = columns.indexOf('descriptions') + 1;

  for (const row of values) {
    // each row is an unique adgroup
    const adGroup: AdGroup = {
      customer_id: row[0],
      customer_name: row[1],
      campaign_id: row[2],
      campaign_name: row[3],
      adgroup_id: row[4],
      adgroup_name: row[5],
      keywords: row[6],
      url: row[7],
      ignore: row[8] === 'TRUE',
      headlines: undefined,
      all_headlines: undefined,
      descriptions: undefined,
    };
    Logger.log(
      `Processing adgroup ${adGroup.adgroup_id} (${adGroup.adgroup_name}) - ${
        rowNo - 1
      } of ${values.length}`
    );
    predictor.clearHistory();

    if (adGroup.ignore) {
      Logger.log(
        `Ignoring adgroup ${adGroup.adgroup_id} (${adGroup.adgroup_name}) as explicitly ignored`
      );
      continue;
    }
    if (!adGroup.keywords) {
      Logger.log(
        `Ignoring adgroup ${adGroup.adgroup_id} (${adGroup.adgroup_name}) as it has no keywords`
      );
      continue;
    }

    const gen_res = predictor.getHeadlines(adGroup);

    adGroup.headlines = gen_res.headlines.join('\n');
    adGroup.all_headlines = [
      ...gen_res.headlines,
      ...(gen_res.long_headlines || []),
    ];
    const all_headlines = [];
    let all_headlines_text = '';
    all_headlines.push(...gen_res.headlines);
    if (gen_res.long_headlines.length) {
      const MAX = Config.ads.rsa_headline_max_length;
      all_headlines.push('\nHeadlines longer than ' + MAX + ':');
      all_headlines.push(...gen_res.long_headlines);
      all_headlines_text = all_headlines.join('\n');
    } else {
      all_headlines_text = adGroup.headlines;
    }
    if (all_headlines_text) {
      Logger.log(
        `[AdGroup ${adGroup.adgroup_id}]: generated headlines: ${all_headlines_text}`
      );
    } else {
      Logger.log(
        `WARNING: no headlines were generated for ${adGroup.adgroup_id} (${adGroup.adgroup_name})`
      );
    }
    sheet.getRange(rowNo, COL_Headlines).setValue(all_headlines_text);
    if (all_headlines_text) {
      adGroup.descriptions = predictor.getDescriptions(adGroup);
      sheet.getRange(rowNo, COL_Descriptions).setValue(adGroup.descriptions);
      if (!adGroup.descriptions) {
        Logger.log(
          `WARNING: no descriptions were generated for ${adGroup.adgroup_id} (${adGroup.adgroup_name})`
        );
      }
    }
    rowNo += 1;
    // update UI on each 10th iteration
    if (rowNo % 10 === 0) {
      SpreadsheetApp.flush();
    }
  }
}

export function generate_rsa_current_row() {
  const row = SpreadsheetApp.getCurrentCell().getRowIndex();
  generate_rsa(row);
}

export function generate_ads_editor() {
  const columns = [
    'Account',
    'Customer ID',
    'Campaign',
    'Ad Group',
    'Final URL',
    'Path 1',
    'Path 2',
    'Headline 1',
    'Headline 1 position',
    'Headline 2',
    'Headline 2 position',
    'Headline 3',
    'Headline 3 position',
    'Headline 4',
    'Headline 4 position',
    'Headline 5',
    'Headline 5 position',
    'Headline 6',
    'Headline 6 position',
    'Headline 7',
    'Headline 7 position',
    'Headline 8',
    'Headline 8 position',
    'Headline 9',
    'Headline 9 position',
    'Headline 10',
    'Headline 10 position',
    'Headline 11',
    'Headline 11 position',
    'Headline 12',
    'Headline 12 position',
    'Headline 13',
    'Headline 13 position',
    'Headline 14',
    'Headline 14 position',
    'Headline 15',
    'Headline 15 position',
    'Description 1',
    'Description 1 position',
    'Description 2',
    'Description 2 position',
    'Description 3',
    'Description 3 position',
    'Description 4',
    'Description 4 position',
  ];
  const sheetSrc = SpreadsheetApp.getActiveSheet();
  if (!sheetSrc.getName().toLocaleLowerCase().startsWith('keywords')) {
    console.log(sheetSrc.getName());
    SpreadsheetApp.getUi().alert(
      'Please switch to a sheet with keywords (it should be titled "keywords")'
    );
    return;
  }
  const valuesSrc = sheetSrc
    .getRange(2, 1, sheetSrc.getLastRow() - 1, 11)
    .getValues();

  const add_long_headlines =
    ConfigReader.getValue(Config.settingsNames.ADSEDITOR_add_long_headlines)
      .toString()
      .toLocaleUpperCase() === 'TRUE';
  const add_long_descriptions =
    ConfigReader.getValue(Config.settingsNames.ADSEDITOR_add_long_descriptions)
      .toString()
      .toLocaleUpperCase() === 'TRUE';
  const add_generic_headlines = ConfigReader.getValue(
    Config.settingsNames.ADSEDITOR_add_generic_headlines
  );
  const add_generic_descriptions = ConfigReader.getValue(
    Config.settingsNames.ADSEDITOR_add_generic_descriptions
  );
  let genericHeadlines;
  let genericDescriptions;
  if (add_generic_headlines) {
    genericHeadlines = SpreadsheetApp.getActiveSpreadsheet()
      .getRange(add_generic_headlines)
      .getValues()
      .map(row => row[0]);
  }
  if (add_generic_descriptions) {
    genericDescriptions = SpreadsheetApp.getActiveSpreadsheet()
      .getRange(add_generic_descriptions)
      .getValues()
      .map(row => row[0]);
  }
  const rows = [];
  for (let i = 0; i < valuesSrc.length; i++) {
    const rowSrc = valuesSrc[i];
    const customer_id = rowSrc[0];
    //const customer_name = rowSrc[1];
    const campaign_id = rowSrc[2];
    const campaign_name = rowSrc[3];
    const adgroup_id = rowSrc[4];
    const adgroup_name = rowSrc[5];
    // 6 - keywords
    const url = rowSrc[7];
    const ignore = rowSrc[8] === 'TRUE';
    const headlines_src = rowSrc[9].split('\n');
    const descriptions_src = rowSrc[10].split('\n');

    if (ignore) continue;
    const row = [
      customer_id,
      campaign_id,
      campaign_name,
      adgroup_name,
      url, // Final URL
      '', // Path 1
      '', // Path 2
    ];
    rows.push(row);
    // add headlines
    const headlines_dst = [];
    for (let j = 0; j < headlines_src.length; j++) {
      const hl = headlines_src[j].trim();
      if (!hl) continue;
      if (hl.includes('Headlines longer')) continue;
      if (hl.length > Config.ads.rsa_headline_max_length && !add_long_headlines)
        continue;
      headlines_dst.push(hl);
      if (headlines_dst.length === 15) break;
    }
    if (headlines_dst.length < 15 && genericHeadlines) {
      const add = 15 - headlines_dst.length;
      for (let j = 0; j < add; j++) {
        headlines_dst.push(genericHeadlines[j]);
      }
    }
    // add final headlines to the row
    for (let j = 0; j < headlines_dst.length; j++) {
      row.push(headlines_dst[j]);
      row.push('');
    }
    for (let j = headlines_dst.length; j < 15; j++) {
      row.push('');
      row.push('');
    }

    // add descriptions
    const descriptions_dst = [];
    for (let j = 0; j < descriptions_src.length; j++) {
      const desc = descriptions_src[j].trim();
      if (!desc) continue;
      if (desc.includes('Descriptions longer')) continue;
      if (
        desc.length > Config.ads.rsa_description_max_length &&
        !add_long_descriptions
      )
        continue;
      descriptions_dst.push(desc);
      if (descriptions_dst.length === 4) break;
    }
    if (descriptions_dst.length < 4 && genericDescriptions) {
      const add = 4 - descriptions_dst.length;
      for (let j = 0; j < add; j++) {
        descriptions_dst.push(genericDescriptions[j]);
      }
    }
    // add final descriptions to the row
    for (let j = 0; j < descriptions_dst.length; j++) {
      row.push(descriptions_dst[j]);
      row.push('');
    }
    for (let j = descriptions_dst.length; j < 4; j++) {
      row.push('');
      row.push('');
    }
  }

  const title = sheetSrc.getName().replace('keywords', 'import');
  const app = SpreadsheetApp.getActiveSpreadsheet();
  const sheetDst = app.insertSheet(title, 0);
  sheetDst.activate();
  sheetDst.getRange(1, 1, 1, columns.length).setValues([columns]);
  //console.log(rows)
  sheetDst.getRange(2, 1, rows.length, columns.length).setValues(rows);
}

class Predictor {
  api: GeminiVertexApi;
  customerName: string;
  promptHeadlinesTemplate: string;
  promptHeadlinesShortenTemplate: string;
  promptDescriptionsTemplate: string;
  history: any[];

  /**
   * @param {PalmApi} api
   * @param {String} customerName
   */
  constructor(api: GeminiVertexApi, customerName: string) {
    this.api = api;
    this.customerName = customerName;
    this.promptHeadlinesTemplate = ConfigReader.getValue(
      Config.settingsNames.LLM_Prompt_Headlines
    );
    this.promptHeadlinesShortenTemplate = ConfigReader.getValue(
      Config.settingsNames.LLM_Prompt_Headlines_Shorten
    );
    this.promptDescriptionsTemplate = ConfigReader.getValue(
      Config.settingsNames.LLM_Prompt_Descriptions
    );
    this.history = [];
  }

  clearHistory() {
    this.history = [];
  }

  normalizeReply(reply: string) {
    const lines = reply.split('\n');
    const headlines = lines
      .map(line => {
        // if (line.startsWith("* ")) {
        //   line = line.replace("* ", "");
        // }
        // else if (line.startsWith("- ")) {
        //   line = line.replace("- ", "");
        // }
        // else if (/^[\d]+\.?\s+/.test(line)) {
        //   line = line.replace(/^[\d]+.?\s+/, '');
        // }
        //
        line = line.replace(/^\s*[\d]+.?\s+|^\s+|^\*\s*|^-\s*|^•\s*/, '');

        if (line.startsWith(this.customerName + ':')) {
          line = line.substring((this.customerName + ':').length, line.length);
        }
        return line;
      })
      .join('\n')
      .replaceAll('**', '')
      .replaceAll('  ', ' ')
      .trim();
    return headlines;
  }

  /**
   * Call model through API to generate headlines for an adgroup's keywords.
   * @param {AdGroup} adgroup
   * @return {}
   */
  getHeadlines(adgroup: AdGroup): {
    headlines: string[];
    long_headlines: string[];
  } {
    let prompt = this.getHeadlinesPrompt(adgroup);
    //Logger.log(`Sending a prompt (headlines): ${prompt}`);

    let reply = this.api.predict(prompt, this.history);
    reply = this.normalizeReply(reply);
    Logger.log(
      `[AdGroup ${adgroup.adgroup_id}] Model's reply (normalized): ${reply}`
    );
    if (!reply) {
      Logger.log(`WARNING: model's response is empty`);
    }
    const MAX = Config.ads.rsa_headline_max_length;
    const MIN = Config.ads.rsa_headline_min_length;
    const org_headlines_arr = reply.split('\n');
    let long_lines = org_headlines_arr.filter(
      line => line.length > MAX || line.length < MIN
    );
    const headlines = org_headlines_arr.filter(
      line => line.length <= MAX && line.length >= MIN
    );
    if (long_lines.length > 0) {
      Logger.log(
        `Model's response contains too long or too short headlines (${long_lines.length} of ${org_headlines_arr.length}), trying to rewrite`
      );
      // 2nd attempt
      prompt = this.getHeadlines2ndPrompt(adgroup, long_lines);
      Logger.log(`Sending 2nd prompt: ${prompt}`);
      reply = this.api.predict(prompt, this.history);
      reply = this.normalizeReply(reply);
      Logger.log(
        `[AdGroup ${adgroup.adgroup_id}] Model's 2nd reply (normalized): ${reply}`
      );
      long_lines = reply
        .split('\n')
        .filter(line => line.length > MAX || line.length < MIN);
      const new_headlines = reply
        .split('\n')
        .filter(line => line.length <= MAX && line.length >= MIN);
      headlines.push(...new_headlines);

      if (long_lines.length) {
        Logger.log(
          `WARNING: Model's response again (after 2nd prompt) contains too long/short headlines (${long_lines.length}):`
        );
        Logger.log(long_lines);
      }
    }
    const result = {
      headlines: headlines, // good ones
      long_headlines: long_lines,
    };

    return result;
  }

  /**
   * Call model through API to generate descriptions for an adgroup.
   * @param {AdGroup} adgroup
   */
  getDescriptions(adgroup: AdGroup) {
    const prompt = this.getDescriptionsPrompt(adgroup);
    Logger.log(`Sending a prompt (descriptions): ${prompt}`);

    let reply = this.api.predict(prompt);
    reply = this.normalizeReply(reply);
    Logger.log(
      `[AdGeoup ${adgroup.adgroup_id}] Model's descriptions reply (normalized): ${reply}`
    );
    // TODO: check for length and shorten if needed

    const MIN = Config.ads.rsa_description_min_length;
    const MAX = Config.ads.rsa_description_max_length;
    const descriptions = reply
      .split('\n')
      .filter(line => line.length <= MAX && line.length >= MIN);
    const long_lines = reply
      .split('\n')
      .filter(line => line.length > MAX || line.length < MIN);

    Logger.log(
      `[AdGroup ${
        adgroup.adgroup_id
      }]: generated descriptions: ${descriptions.join(';')}`
    );
    if (long_lines.length > 0) {
      Logger.log(`${long_lines.length} descriptions are longer ${MAX}`);
      descriptions.push('\nDescriptions longer than ' + MAX + ':');
      descriptions.push(...long_lines);
    }
    return descriptions.join('\n');
  }

  /**
   * Call model through API to generate headlines for an adgroup's keywords.
   * @param {AdGroup} adgroup
   */
  getHeadlinesPrompt(adgroup: AdGroup) {
    const customerName = this.customerName || ' a ';
    const promptTemplate =
      this.promptHeadlinesTemplate ||
      `You are a marketing specialist accountable for generating search campaigns for {CUSTOMER_NAME} customer.
Please generate 15 best selling creative headlines of maximum 25 symbols each for a Google Ads search campaign (RSA) using the following keywords as an input (each keyword is on a separate line):

{KEYWORDS}

Please strictly limit each headline to 25 characters.
Return only a list of headlines, one per line, do not add any markup or any additional text.`;

    return this._getPrompt(promptTemplate, adgroup.keywords, {
      CUSTOMER_NAME: customerName,
    });
  }

  /**
   * Create second prompt for rewriting headlines that exceeded the maximums
   * @param {AdGroup} adgroup
   * @param {string[]} line_lines
   */
  getHeadlines2ndPrompt(adgroup: AdGroup, long_lines: string[]) {
    const promptTemplate =
      this.promptHeadlinesShortenTemplate ||
      `Some of the generated headlines are shorter or longer than the minimum ({MIN}) and the maximum ({MAX}), please rewrite them to be not shorter than {MIN} and not longer than {MAX}. Again do not add anything to your response except rewritten headlines:\n\n{HEADLINES}`;
    const long_headlines = long_lines.map(line => '* ' + line).join('\n');
    return this._getPrompt(promptTemplate, undefined, {
      HEADLINES: long_headlines,
      MIN: Config.ads.rsa_headline_min_length,
      MAX: Config.ads.rsa_headline_max_length,
    });
  }

  getDescriptionsPrompt(adgroup: AdGroup) {
    const customerName = this.customerName || ' a ';
    const promptTemplate =
      this.promptDescriptionsTemplate ||
      `You are a marketing specialist accountable for generating search campaigns for {CUSTOMER_NAME} customer.
Please generate 4 best selling creative descriptions of maximum 80 characters each for a Google Ads search campaign (RSA) using the following keywords as an input (each keyword is on a separate line):

{KEYWORDS}

And the following headlines you previously created:
{HEADLINES}

Please strictly limit each description to 80 characters.
Return only a list of descriptions, one per line, do not add any markup or any additional text.`;

    return this._getPrompt(promptTemplate, adgroup.keywords, {
      CUSTOMER_NAME: customerName,
      HEADLINES: adgroup.all_headlines!.join('\n'),
      MIN: Config.ads.rsa_description_min_length,
      MAX: Config.ads.rsa_description_max_length,
    });
  }

  _getPrompt(
    promptTemplate: string,
    keywords: string | undefined,
    args: Record<string, any>
  ) {
    let prompt = promptTemplate;
    if (!keywords) {
      for (const name of Object.keys(args)) {
        prompt = prompt.replaceAll('{' + name + '}', args[name]);
      }
      if (prompt.length >= Config.vertexAi.maxRequestLength) {
        Logger.log(
          `WARNING: prompt's length (${prompt.length}) after substitution is longer that the model's limit (${Config.vertexAi.maxRequestLength}):\n${prompt}`
        );
      }
      return prompt;
    }
    const keywords_arr = keywords.split('\n');
    let itemNum = keywords_arr.length;

    // we have to limit length of input
    do {
      for (const name of Object.keys(args)) {
        prompt = prompt.replaceAll('{' + name + '}', args[name]);
      }
      prompt = prompt.replace('{KEYWORDS}', keywords);
      itemNum -= 1;
      if (itemNum === 0) {
        break;
      }
      // remove the last keyword and repeat
      keywords = keywords_arr.slice(0, itemNum - 1).join('\n');
      if (itemNum < keywords_arr.length - 1) {
        Logger.log(`request is too long (${prompt.length}), shortening`);
      }
    } while (prompt.length >= Config.vertexAi.maxRequestLength);
    return prompt;
  }
}

class GeminiVertexApi {
  project_id: string;
  url: string;
  modelParams: any;
  logging: boolean;

  constructor(
    project_id: string,
    gcp_region: string,
    model_name?: string,
    model_params?: any
  ) {
    this.project_id = project_id;
    if (!gcp_region) {
      gcp_region = Config.vertexAi.location || 'us-central1';
    }
    if (!model_name) {
      model_name = Config.vertexAi.modelName || 'gemini-pro';
    }
    this.url = `https://${gcp_region}-aiplatform.googleapis.com/v1/projects/${project_id}/locations/${gcp_region}/publishers/google/models/${model_name}:streamGenerateContent`;
    this.modelParams = Object.assign(
      { candidateCount: 1 },
      Config.vertexAi.modelParams,
      model_params
    );
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
      safetySettings: [
        {
          category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT',
          threshold: 'BLOCK_LOW_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_HATE_SPEECH',
          threshold: 'BLOCK_LOW_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_HARASSMENT',
          threshold: 'BLOCK_LOW_AND_ABOVE',
        },
        {
          category: 'HARM_CATEGORY_DANGEROUS_CONTENT',
          threshold: 'BLOCK_LOW_AND_ABOVE',
        },
      ],
      generationConfig: this.modelParams,
      // instances: [{
      //   context: "",
      //   examples: [],
      //   messages: history.slice(0, history.length)
      // }],
      // parameters: this.modelParams,
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
      payload: JSON.stringify(data),
      muteHttpExceptions: true,
    };
    if (this.logging) {
      Logger.log(
        `GeminiApi: request to ${this.url}\n: ${JSON.stringify(request)}`
      );
    }

    const res = fetchJson(this.url, request);
    if (this.logging) {
      Logger.log(`GeminiApi: recieved response: ${JSON.stringify(res)}`);
    }
    if (res.length) {
      // streamGenerateContent returns an array of response that should be merged into one
      let reply = '';
      for (const res_item of res) {
        const text = this._parseResponse(res_item, prompt);
        reply += text;
      }
      history.push({
        role: 'model',
        parts: [
          {
            text: reply,
          },
        ],
      });
      return reply;
    }
    // if (res.candidates) {
    //   if (res.candidates[0].content) {
    //     const result = res.candidates[0].content;
    //     if (!result.parts[0].text) {
    //       throw new Error(`Could not find expected response content. Full response: ${JSON.stringify(res)}`);
    //     }
    //     history.push(result.parts[0].text);
    //     return result;
    //   } else {
    //     throw new Error(`Received empty response from API. Prompt: ${prompt}. Full response: ${JSON.stringify(res)}`);
    //   }
    // }
    else if (res.promptFeedback && res.promptFeedback.blockReason) {
      throw new Error(
        `Request was blocked as it triggered API safety filters. Reason: ${res.promptFeedback.blockReason}.\n Original prompt: ${prompt}`
      );
    } else {
      throw new Error(`Uknown response from the API: ${JSON.stringify(res)}`);
    }
  }
  _parseResponse(res: any, prompt: string) {
    if (res.candidates) {
      if (res.candidates[0].content) {
        const result = res.candidates[0].content;
        if (!result.parts || !result.parts.length) {
          return;
        }
        // if (!result.parts[0].text) {
        //   throw new Error(`Could not find expected response content. Full response: ${JSON.stringify(res)}`);
        // }
        return result.parts[0].text;
      } else {
        throw new Error(
          `Received empty response from API. Prompt: ${prompt}. Full response: ${JSON.stringify(
            res
          )}`
        );
      }
    }
  }
}

/*
class PalmChatApi {
  constructor(project_id, gcp_region, model_name, model_params) {
    this.project_id = project_id;
    if (!gcp_region) {
      gcp_region = Config.vertexAi.location;
    }
    if (!model_name) {
      model_name = Config.vertexAi.modelName;
    }
    this.url = `https://${gcp_region}-aiplatform.googleapis.com/v1/projects/${project_id}/locations/${gcp_region}/publishers/google/models/${model_name}:predict`;
    this.modelParams = Object.assign(
      {},
      Config.vertexAi.modelParams,
      model_params
    );
    this.logging = false;
  }

  predict(prompt, history) {
    history = history || [];
    history.push({
      author: 'user',
      content: prompt,
    });
    const data = {
      instances: [
        {
          context: '',
          examples: [],
          messages: history.slice(0, history.length),
        },
      ],
      parameters: this.modelParams,
    };
    if (this.logging) {
      Logger.log(`PalmChatApi: sending payload: ${JSON.stringify(data)}`);
    }

    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${ScriptApp.getOAuthToken()}`,
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true,
    };
    const res = fetchJson(this.url, request);
    if (this.logging) {
      Logger.log(`PalmChatApi: recieved response: ${JSON.stringify(res)}`);
    }
    if (res.predictions) {
      if (res.predictions[0].safetyAttributes.blocked) {
        throw new Error(
          `Request was blocked as it triggered API safety filters. Prompt: ${prompt}`
        );
      } else if (
        !res.predictions[0].candidates ||
        !res.predictions[0].candidates.length ||
        !res.predictions[0].candidates[0].content
      ) {
        throw new Error(`Received empty response from API. Prompt: ${prompt}`);
      } else {
        const result = res.predictions[0].candidates[0].content;
        history.push({
          author: 'bot',
          content: result,
          citationMetadata: {
            citations: [],
          },
        });
        return result;
      }
    }
  }
}

class PalmTextApi {
  constructor(project_id, gcp_region, model_name, model_params) {
    this.project_id = project_id;
    if (!gcp_region) {
      gcp_region = Config.vertexAi.location;
    }
    if (!model_name) {
      model_name = Config.vertexAi.modelName;
    }
    this.url = `https://${gcp_region}-aiplatform.googleapis.com/v1/projects/${project_id}/locations/${gcp_region}/publishers/google/models/${model_name}:predict`;
    this.modelParams = Object.assign(
      {},
      Config.vertexAi.modelParams,
      model_params
    );
  }

  predict(prompt) {
    const data = {
      instances: [{ content: prompt }],
      parameters: this.modelParams,
    };
    Logger.log(`PaLM API payload: ${JSON.stringify(data)}`);

    const request = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'authorization': `Bearer ${ScriptApp.getOAuthToken()}`,
      },
      payload: JSON.stringify(data),
      muteHttpExceptions: true,
    };
    const res = fetchJson(this.url, request);
    if (res.predictions) {
      if (res.predictions[0].safetyAttributes.blocked) {
        throw new Error(
          `Request was blocked as it triggered API safety filters. Prompt: ${prompt}`
        );
      } else if (!res.predictions[0].content) {
        throw new Error(`Received empty response from API. Prompt: ${prompt}`);
      } else {
        return res.predictions[0].content;
      }
    }
  }
}
*/
