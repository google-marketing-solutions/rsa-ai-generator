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

import { GoogleAdsClient } from './google-ads';
import {
  ConfigReader,
  SETTINGS,
  Config,
  ConfigSheetReader,
  IConfigReader,
} from './config';
import { GeminiVertexApi } from './vertex-api';

export const app = null;

export function enter_dev_token() {
  const res = SpreadsheetApp.getUi().prompt('Enter developer token');
  const dev_token = res.getResponseText();
  const documentProperties = PropertiesService.getDocumentProperties();
  documentProperties.setProperty(SETTINGS.ADS_DEV_TOKEN, dev_token);
}

export async function fetch_keywords() {
  const mccId = ConfigReader.getValue(SETTINGS.MCC);
  const seedCustomerId = ConfigReader.getValue(SETTINGS.CID) || mccId;
  const campaignId = ConfigReader.getValue(SETTINGS.CAMPAIGN);
  const maxKeywords = ConfigReader.getValue(SETTINGS.MAX_KEYWORDS) || 20;
  if (!seedCustomerId) {
    SpreadsheetApp.getUi().alert(
      'Please specify a customer id in the CID and/or MCC fields on the Configuration sheet'
    );
    return;
  }
  const devToken =
    ConfigReader.getValue(SETTINGS.ADS_DEV_TOKEN) ||
    PropertiesService.getDocumentProperties().getProperty(
      SETTINGS.ADS_DEV_TOKEN
    );
  if (!devToken) {
    SpreadsheetApp.getUi().alert(
      'Please specify a developer token either on the Configuration sheet or enter via prompt from the menu (to keep it secretly)'
    );
    return;
  }
  const client = new GoogleAdsClient(
    {
      devToken: devToken,
      mccId: mccId,
    },
    new ConfigSheetReader()
  );

  const customerIds = await client.expandCustomers(seedCustomerId);

  const sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(
    `keywords - ${seedCustomerId} - ${new Date().toISOString()}`,
    0
  );
  let headers;
  let startRow = 2;
  for (const cid of customerIds) {
    const kws = getAllKeywords(client, cid, campaignId, maxKeywords);
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
 * @param [String] campaignId
 * @returns {Array<AdGroup>}
 */
function getAllKeywords(
  client: GoogleAdsClient,
  customerId: string,
  campaignId?: string,
  maxKeywords?: string
): AdGroup[] {
  let queryKw = `SELECT
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
    AND ad_group.status = ENABLED
    AND campaign.status = ENABLED
    AND ad_group_criterion.status = ENABLED
    AND metrics.clicks > 0
  `;

  let queryAds = `SELECT
    ad_group.id,
    ad_group_ad.ad.final_urls
  FROM ad_group_ad
  WHERE ad_group.type = SEARCH_STANDARD
    AND ad_group.status = ENABLED
    AND campaign.status = ENABLED
  `;
  if (campaignId) {
    queryKw += `\nAND campaign.id = ${campaignId}`;
    queryAds += `\nAND campaign.id = ${campaignId}`;
  }
  queryKw += `\nORDER BY customer.id, campaign.id, ad_group.id, metrics.clicks DESC`;
  queryAds += `\nORDER BY ad_group.id`;
  Logger.log(
    `Fetching ad_group_ad for CID=${customerId}, campaign=${campaignId}`
  );
  const rowsAds = client.execQuery(queryAds, customerId);

  const adgroupUrls: Record<number, string[]> = {};
  let adgroupId;
  if (rowsAds && rowsAds.length) {
    for (const row of rowsAds) {
      const urls = row.adGroupAd.ad.finalUrls;
      if (urls && urls.length) {
        if (row.adGroup.id !== adgroupId) {
          adgroupUrls[row.adGroup.id] = urls;
        } else {
          if (!adgroupUrls[row.adGroup.id]) {
            adgroupUrls[row.adGroup.id] = [];
          }
          adgroupUrls[row.adGroup.id].push(...urls);
        }
      }
      adgroupId = row.adGroup.id;
    }
  }

  Logger.log(`Fetching keywords for CID=${customerId}, campaign=${campaignId}`);
  const rows = client.execQuery(queryKw, customerId);
  if (!rows || !rows.length) {
    return [];
  }

  adgroupId = undefined;
  const results: AdGroup[] = [];
  let current: AdGroup | undefined = undefined;
  for (const row of rows) {
    // we'll group keywords by adgroup
    if (row.adGroup.id !== adgroupId) {
      // current adgroup has changed (including the case of the first row)
      current = {
        customer_id: row.customer.id,
        customer_name: row.customer.descriptiveName,
        campaign_id: row.campaign.id,
        campaign_name: row.campaign.name,
        adgroup_id: row.adGroup.id,
        adgroup_name: row.adGroup.name,
        keywords_array: [row.adGroupCriterion.keyword.text],
        url: adgroupUrls[row.adGroup.id] ? adgroupUrls[row.adGroup.id][0] : '',
        ignore: false,
      };
      results.push(current);
    } else {
      // same adgroup as before
      current!.keywords_array!.push(row.adGroupCriterion.keyword.text);
    }
    adgroupId = row.adGroup.id;
  }
  if (maxKeywords) {
    const maxKeywordsNum = parseInt(maxKeywords);
    for (const adgroup of results) {
      adgroup.keywords_array!.splice(maxKeywordsNum);
      // sometime people add "+" to keywords, remove them
      for (let i = 0; i < adgroup.keywords_array!.length; i++) {
        const kw = adgroup.keywords_array![i].replaceAll('+', '');
        adgroup.keywords_array![i] = kw;
      }
    }
  }
  return results;
}

/**
 * @class AdGroup
 * @description the fields names are used as headers in 'keywords' sheets
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
  url: string;
  ignore: boolean;
  headlines?: string;
  all_headlines?: string[];
  descriptions?: string;
}

function _get_predictor() {
  const projectId = ConfigReader.getValue(SETTINGS.CLOUD_PROJECT_ID);
  if (!projectId) {
    SpreadsheetApp.getUi().alert(
      'Please provide a GCP project id on the Configuration sheet (you should also enable Vertex API in that proejct)'
    );
    return;
  }
  const customerName = ConfigReader.getValue(SETTINGS.CUSTOMER_NAME);
  if (!customerName) {
    SpreadsheetApp.getUi().alert(
      'Please specify a customer name on the Configuration sheet'
    );
    return;
  }

  const api = new GeminiVertexApi(projectId, new ConfigSheetReader());
  api.logging =
    ConfigReader.getValue(SETTINGS.LOGGING).toString().toLocaleUpperCase() ===
    'TRUE';
  const predictor = new Predictor(api, customerName);
  return predictor;
}

/**
 * Root function for calling from the UI menu.
 * Goes through all keywords (they should be fetched first via fetch_keywords)
 *   and generates headlines via PaLM API.
 */
export function generate_rsa(rowToProcess?: number) {
  const sheet = SpreadsheetApp.getActiveSheet();
  if (!sheet.getName().toLocaleLowerCase().startsWith('keywords')) {
    console.log(sheet.getName());
    SpreadsheetApp.getUi().alert(
      'Please switch to a sheet with keywords (it should be titled "keywords")'
    );
    return;
  }

  const predictor = _get_predictor();
  if (!predictor) return;

  let rowNo = rowToProcess || 2;
  const rowNums = rowToProcess ? 1 : sheet.getLastRow() - 1;
  const lastCol = sheet.getLastColumn();
  const values = sheet.getRange(rowNo, 1, rowNums, lastCol - 2).getValues();
  Logger.log(
    `Generating headlines for "${predictor.customerName}" for all ${values.length} adgroups`
  );

  // A/1: customer_id, B/2: customer_name, C/3:campaign_id, D/4: campaign_name, E/5: adgroup_id, F/6: adgroup_name, G/7: keywords, H/8: urls, I/9: ignore, J/10: headlines, K/11: descriptions
  const columns = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const COL_Headlines = columns.indexOf('headlines') + 1;
  const COL_Descriptions = columns.indexOf('descriptions') + 1;

  if (COL_Headlines === 0) {
    throw new Error('Could not fild a column with title "headlines"');
  }
  if (COL_Descriptions === 0) {
    throw new Error('Could not fild a column with title "descriptions"');
  }
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
      ignore: row[8] === true || row[8] === 'TRUE',
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

    const genRes = predictor.getHeadlines(adGroup);

    adGroup.headlines = genRes.headlines.join('\n');
    adGroup.all_headlines = [
      ...genRes.headlines,
      ...(genRes.longHeadlines || []),
    ];
    const allHeadlines = [];
    let allHeadlinesText = '';
    allHeadlines.push(...genRes.headlines);
    if (genRes.longHeadlines.length) {
      const MAX = Config.ads.rsa_headline_max_length;
      allHeadlines.push('\nHeadlines longer than ' + MAX + ':');
      allHeadlines.push(...genRes.longHeadlines);
      allHeadlinesText = allHeadlines.join('\n');
    } else {
      allHeadlinesText = adGroup.headlines;
    }
    if (allHeadlinesText) {
      Logger.log(
        `[AdGroup ${adGroup.adgroup_id}]: generated headlines: ${allHeadlinesText}`
      );
    } else {
      Logger.log(
        `WARNING: no headlines were generated for ${adGroup.adgroup_id} (${adGroup.adgroup_name})`
      );
    }
    sheet.getRange(rowNo, COL_Headlines).setValue(allHeadlinesText);
    if (allHeadlinesText) {
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
  const ui = SpreadsheetApp.getUi();
  let row = SpreadsheetApp.getCurrentCell().getRowIndex();
  const res = ui.prompt(
    `Run generation for the row with index ${row}. Or enter another row index`,
    ui.ButtonSet.YES_NO
  );
  if (res.getSelectedButton() === ui.Button.YES) {
    row = res.getResponseText() ? parseInt(res.getResponseText()) : row;
    generate_rsa(row);
  }
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

  const addLongHeadlines =
    ConfigReader.getValue(SETTINGS.ADSEDITOR_add_long_headlines)
      .toString()
      .toLocaleUpperCase() === 'TRUE';
  const addLongDescriptions =
    ConfigReader.getValue(SETTINGS.ADSEDITOR_add_long_descriptions)
      .toString()
      .toLocaleUpperCase() === 'TRUE';
  const addGenericHeadlines = ConfigReader.getValue(
    SETTINGS.ADSEDITOR_add_generic_headlines
  );
  const addGenericDescriptions = ConfigReader.getValue(
    SETTINGS.ADSEDITOR_add_generic_descriptions
  );
  let genericHeadlines;
  let genericDescriptions;
  if (addGenericHeadlines) {
    genericHeadlines = SpreadsheetApp.getActiveSpreadsheet()
      .getRange(addGenericHeadlines)
      .getValues()
      .map(row => row[0]);
  }
  if (addGenericDescriptions) {
    genericDescriptions = SpreadsheetApp.getActiveSpreadsheet()
      .getRange(addGenericDescriptions)
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
    const ignore = rowSrc[8];
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
    const headlinesDst = [];
    for (let j = 0; j < headlines_src.length; j++) {
      const hl = headlines_src[j].trim();
      if (!hl) continue;
      if (hl.includes('Headlines longer')) continue;
      if (hl.length > Config.ads.rsa_headline_max_length && !addLongHeadlines)
        continue;
      headlinesDst.push(hl);
      if (headlinesDst.length === 15) break;
    }
    if (headlinesDst.length < 15 && genericHeadlines) {
      const add = 15 - headlinesDst.length;
      for (let j = 0; j < add; j++) {
        headlinesDst.push(genericHeadlines[j]);
      }
    }
    // add final headlines to the row
    for (let j = 0; j < headlinesDst.length; j++) {
      row.push(headlinesDst[j]);
      row.push('');
    }
    for (let j = headlinesDst.length; j < 15; j++) {
      row.push('');
      row.push('');
    }

    // add descriptions
    const descriptionsDst = [];
    for (let j = 0; j < descriptions_src.length; j++) {
      const desc = descriptions_src[j].trim();
      if (!desc) continue;
      if (desc.includes('Descriptions longer')) continue;
      if (
        desc.length > Config.ads.rsa_description_max_length &&
        !addLongDescriptions
      )
        continue;
      descriptionsDst.push(desc);
      if (descriptionsDst.length === 4) break;
    }
    if (descriptionsDst.length < 4 && genericDescriptions) {
      const add = 4 - descriptionsDst.length;
      for (let j = 0; j < add; j++) {
        descriptionsDst.push(genericDescriptions[j]);
      }
    }
    // add final descriptions to the row
    for (let j = 0; j < descriptionsDst.length; j++) {
      row.push(descriptionsDst[j]);
      row.push('');
    }
    for (let j = descriptionsDst.length; j < 4; j++) {
      row.push('');
      row.push('');
    }
  }

  let title = sheetSrc.getName().replace('keywords', 'import');
  title = title.replace(
    /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g,
    new Date().toISOString()
  );
  const app = SpreadsheetApp.getActiveSpreadsheet();
  if (app.getSheetByName(title)) {
    title = title + ' - 1';
  }
  const sheetDst = app.insertSheet(title, 0);
  sheetDst.activate();
  sheetDst.getRange(1, 1, 1, columns.length).setValues([columns]);
  sheetDst.getRange(2, 1, rows.length, columns.length).setValues(rows);
}

function _normalizeKeywordForCustomizerFeed(kw: string) {
  if (!kw) return kw;
  kw = kw.replaceAll(/["'`[\]+\-|!]/gi, '').trim();
  kw = kw[0].toUpperCase() + kw.substring(1);
  return kw;
}

export function generate_customizer_feed() {
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

  const useLlm = !(
    ConfigReader.getValue(SETTINGS.ADS_CUSTOMIZER_use_llm) === false
  );

  let predictor: Predictor | undefined = undefined;
  if (useLlm) {
    predictor = _get_predictor();
    if (!predictor) return;
  }
  const customizerName =
    ConfigReader.getValue(SETTINGS.ADS_CUSTOMIZER_NAME) || 'CustomDKI';

  const rows = [];
  let current_cid = '';
  for (let i = 0; i < valuesSrc.length; i++) {
    const rowSrc = valuesSrc[i];
    const customer_id = rowSrc[0];
    const campaign_id = rowSrc[2];
    const adgroup_id = rowSrc[4];
    const keywords_array = rowSrc[6].split('\n');
    const ignore = rowSrc[8];
    if (ignore) continue;
    if (current_cid !== customer_id) {
      rows.push([customizerName, 'Text', '', customer_id, '', '', '', '']);
      current_cid = customer_id;
    }
    if (keywords_array.length) {
      if (predictor) {
        const values = predictor.getCustomizers(keywords_array);
        const length = Math.min(values.length, keywords_array.length);
        for (let j = 0; j < length; j++) {
          const kwSrc = keywords_array[j];
          const kwDst = values[j];
          const row = [
            '',
            '',
            '',
            customer_id,
            campaign_id,
            adgroup_id,
            kwSrc,
            kwDst,
          ];
          rows.push(row);
        }
      } else {
        for (const kw of keywords_array) {
          const row = [
            '',
            '',
            '',
            customer_id,
            campaign_id,
            adgroup_id,
            kw,
            _normalizeKeywordForCustomizerFeed(kw),
          ];
          rows.push(row);
        }
      }
    }
  }
  const columns = [
    'Attribute',
    'Data type',
    'Account value',
    'Customer ID',
    'Campaign ID',
    'Ad group ID',
    'Keyword',
    'Customizer:' + customizerName,
  ];
  let title = sheetSrc.getName().replace('keywords', 'feed');
  title = title.replace(
    /\d\d\d-\d\d-\d\dT\d\d:\d\d:\d\d\.\d\d\dZ/g,
    new Date().toISOString()
  );
  Logger.log('Inserting a new sheet: ' + title);
  const app = SpreadsheetApp.getActiveSpreadsheet();
  if (app.getSheetByName(title)) {
    title = title + ' - 1';
  }
  const sheetDst = app.insertSheet(title, 0);
  sheetDst.activate();
  sheetDst.getRange(1, 1, 1, columns.length).setValues([columns]);
  sheetDst.getRange(2, 1, rows.length, columns.length).setValues(rows);
}

export class Predictor {
  api: GeminiVertexApi;
  configReader: IConfigReader;
  customerName: string;
  promptHeadlinesTemplate: string;
  promptHeadlinesShortenTemplate: string;
  promptDescriptionsTemplate: string;
  promptCustomizersTemplate: string;
  history: any[];

  static DEFAULT_PROMPT_HEADLINES = `You are a marketing specialist accountable for generating search campaigns for {CUSTOMER_NAME} customer.
Generate a JSON array containing exactly 15 creative headlines. Each headline must be strictly limited to 25 characters. Use the keywords below (each keyword is on a separate line), and do not add any additional text, symbols, or formatting to the JSON response:

{KEYWORDS}

{SUFFIX}`;

  static DEFAULT_PROMPT_HEADLINES_SHORTEN = `Some of the generated headlines are shorter or longer than the minimum ({MIN}) and the maximum ({MAX}) respectedly.
Please rewrite the following headlines to be not shorter than {MIN} and not longer than {MAX} symbols. Only rewrite the specified headlines in this message, do not add the previous ones.
Please reply in JSON format and return a JSON array of strings with headlines as elements.
Again do not add anything to your generated text. The headlines to rewrite are:\n\n{HEADLINES}`;

  static DEFAULT_PROMPT_DESCRIPTIONS = `You are a marketing specialist accountable for generating search campaigns for {CUSTOMER_NAME} customer.
Please generate 4 best selling creative descriptions of maximum 80 characters each for a Google Ads search campaign (RSA) using the following keywords as an input (each keyword is on a separate line):

{KEYWORDS}

And the following headlines you previously created:
{HEADLINES}

Please strictly limit each description to 80 characters.
Please reply in JSON format and return a JSON array of strings with descriptions as elements.
Do not add any special symbols, e.g. emoji, in generated text.
{SUFFIX}`;

  static DEFAULT_PROMPT_CUSTOMIZERS = `You are transforming keywords into compelling headlines for Google Ads Responsive Search Ads (RSAs).
These headlines will be dynamically matched to user search terms for maximum relevance. Importantly, preserve the language of each input keyword in its corresponding output headline.

*Instructions*:

1. Increase Selling Appeal: Make the keywords more enticing and action-oriented while staying relevant to the original meaning.
2. Concise Formatting:
  * Headline Case: Capitalize the first letter of each word.
  * Character Limit: Strictly adhere to the {MAX}-character maximum per headline.
  * Special Characters: Remove any symbols except letters and digits.
3. 1:1 Mapping: Maintain the original order, ensuring the output has the same number of headlines as the input keywords.
4. Language Matching: Detect the language of each input keyword and generate the headline in the same language.
5. Output Format: Return a JSON array of strings, where each string is a transformed headline. Do not add anything around the code block.

Input Keywords (one per line):
{KEYWORDS}

{SUFFIX}
`;

  /**
   * @param {PalmApi} api
   * @param {String} customerName
   */
  constructor(api: GeminiVertexApi, customerName: string) {
    this.api = api;
    this.configReader = api.configReader;
    this.customerName = customerName;
    this.promptHeadlinesTemplate =
      this.configReader.getValue(SETTINGS.LLM_Prompt_Headlines) ||
      Predictor.DEFAULT_PROMPT_HEADLINES;
    this.promptHeadlinesShortenTemplate =
      this.configReader.getValue(SETTINGS.LLM_Prompt_Headlines_Shorten) ||
      Predictor.DEFAULT_PROMPT_HEADLINES_SHORTEN;
    this.promptDescriptionsTemplate =
      this.configReader.getValue(SETTINGS.LLM_Prompt_Descriptions) ||
      Predictor.DEFAULT_PROMPT_DESCRIPTIONS;
    this.promptCustomizersTemplate =
      this.configReader.getValue(SETTINGS.LLM_Prompt_Customizers) ||
      Predictor.DEFAULT_PROMPT_CUSTOMIZERS;
    this.history = [];
  }

  clearHistory() {
    this.history = [];
  }

  _normalizeReply(reply: string) {
    reply = reply || '';
    let headlines = '';
    try {
      reply = reply.replaceAll(/```\s*(json|JSON)/g, '').replaceAll(/```/g, '');
      const jsonReply = JSON.parse(reply);
      headlines = jsonReply.join('\n');
    } catch (e) {
      Logger.log(
        `WARNING: failed to parse response as JSON: ${e}, falling back to text`
      );
    }
    if (headlines) {
      return headlines;
    }
    const lines = reply.split('\n');
    headlines = lines
      .map(line => {
        line = line.replace(/^\s*[\d]+.?\s+|^\s+|^\*\s*|^-\s*|^•\s*|\[|\]/, '');
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
   * Create a prompt for generating headlines for an adgroup's keywords.
   * @param {AdGroup} adgroup
   */
  getHeadlines(adgroup: AdGroup): {
    headlines: string[];
    longHeadlines: string[];
  } {
    let prompt = this.getHeadlinesPrompt(adgroup);
    Logger.log(`Sending a prompt (headlines): ${prompt}`);

    let reply = this.api.predict(prompt, this.history);
    reply = this._normalizeReply(reply);
    Logger.log(
      `[AdGroup ${adgroup.adgroup_id}] Model's reply (normalized): ${reply}`
    );
    if (!reply) {
      Logger.log(`WARNING: model's response is empty`);
    }
    const MAX = Config.ads.rsa_headline_max_length;
    const MIN = Config.ads.rsa_headline_min_length;
    const orgHeadlinesArr = reply ? reply.split('\n') : [];
    let longLines = orgHeadlinesArr.filter(
      line => line.length > MAX || line.length < MIN
    );
    const headlines = orgHeadlinesArr.filter(
      line => line.length <= MAX && line.length >= MIN
    );
    if (longLines.length > 0) {
      Logger.log(
        `Model's response contains too long or too short headlines (${longLines.length} of ${orgHeadlinesArr.length}), trying to rewrite`
      );
      // 2nd attempt
      prompt = this.getHeadlines2ndPrompt(adgroup, longLines);
      Logger.log(`Sending 2nd prompt: ${prompt}`);
      reply = this.api.predict(prompt, this.history);
      reply = this._normalizeReply(reply);
      Logger.log(
        `[AdGroup ${adgroup.adgroup_id}] Model's 2nd reply (normalized): ${reply}`
      );
      const longLines2 = reply
        ? reply
            .split('\n')
            .filter(line => line.length > MAX || line.length < MIN)
        : [];
      if (longLines2.length) {
        longLines = longLines2;
      }
      const newHeadlines = reply
        ? reply
            .split('\n')
            .filter(line => line.length <= MAX && line.length >= MIN)
        : [];
      headlines.push(...newHeadlines);

      if (longLines2.length) {
        Logger.log(
          `WARNING: Model's response again (after 2nd prompt) contains too long/short headlines (${longLines2.length}):`
        );
        Logger.log(longLines2);
      }
    }
    const result = {
      headlines: headlines, // good ones
      longHeadlines: longLines,
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
    reply = this._normalizeReply(reply);
    Logger.log(
      `[AdGeoup ${adgroup.adgroup_id}] Model's descriptions reply (normalized): ${reply}`
    );
    // TODO: check for length and shorten if needed

    const MIN = Config.ads.rsa_description_min_length;
    const MAX = Config.ads.rsa_description_max_length;
    const descriptions = reply
      ? reply
          .split('\n')
          .filter(line => line.length <= MAX && line.length >= MIN)
      : [];
    const long_lines = reply
      ? reply.split('\n').filter(line => line.length > MAX || line.length < MIN)
      : [];

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
   * Create a prompt for generating headlines for an adgroup's keywords.
   * @param {AdGroup} adgroup
   */
  getHeadlinesPrompt(adgroup: AdGroup) {
    const customerName = this.customerName || ' a ';
    return this._getPrompt(this.promptHeadlinesTemplate, adgroup.keywords, {
      CUSTOMER_NAME: customerName,
      MIN: Config.ads.rsa_headline_min_length,
      MAX: Config.ads.rsa_headline_max_length,
      SUFFIX: this.configReader.getValue(SETTINGS.LLM_Prompt_Headlines_Suffix),
    });
  }

  /**
   * Create second prompt for rewriting headlines that exceeded the maximums
   * @param {AdGroup} adgroup
   * @param {string[]} line_lines
   */
  getHeadlines2ndPrompt(adgroup: AdGroup, long_lines: string[]) {
    const promptTemplate = this.promptHeadlinesShortenTemplate;
    const longHeadlines = long_lines.map(line => '* ' + line).join('\n');
    return this._getPrompt(promptTemplate, undefined, {
      HEADLINES: longHeadlines,
      MIN: Config.ads.rsa_headline_min_length,
      MAX: Config.ads.rsa_headline_max_length,
    });
  }

  /**
   * Create a prompt for generating descriptions for an adgroup's keywords.
   * @param {AdGroup} adgroup
   */
  getDescriptionsPrompt(adgroup: AdGroup) {
    const customerName = this.customerName || ' a ';
    const promptTemplate = this.promptDescriptionsTemplate;
    return this._getPrompt(promptTemplate, adgroup.keywords, {
      CUSTOMER_NAME: customerName,
      HEADLINES: adgroup.all_headlines!.join('\n'),
      MIN: Config.ads.rsa_description_min_length,
      MAX: Config.ads.rsa_description_max_length,
      SUFFIX: this.configReader.getValue(
        SETTINGS.LLM_Prompt_Descriptions_Suffix
      ),
    });
  }

  /**
   * Call model through API to generate customizer feed values for an adgroup.
   * @param {AdGroup} adgroup
   */
  getCustomizers(keywords: string[]) {
    const keywords_str = keywords.join('\n');
    const prompt = this._getPrompt(
      this.promptCustomizersTemplate,
      keywords_str,
      {
        CUSTOMER_NAME: this.customerName,
        MIN: Config.ads.rsa_headline_min_length,
        MAX: Config.ads.rsa_headline_max_length,
        SUFFIX: this.configReader.getValue(
          SETTINGS.LLM_Prompt_Customizers_Suffix
        ),
      }
    );
    let reply = this.api.predict(prompt);
    reply = this._normalizeReply(reply);
    return reply.split('\n');
  }

  _getPrompt(
    promptTemplate: string,
    keywords: string | undefined,
    args: Record<string, any>
  ) {
    let prompt = promptTemplate;
    if (!keywords) {
      for (const name of Object.keys(args)) {
        prompt = prompt.replaceAll(
          '{' + name + '}',
          args[name] === undefined || args[name] === null ? '' : args[name]
        );
      }
      if (prompt.length >= Config.vertexAi.maxRequestLength) {
        Logger.log(
          `WARNING: prompt's length (${prompt.length}) after substitution is longer that the model's limit (${Config.vertexAi.maxRequestLength}):\n${prompt}`
        );
      }
      return prompt;
    }
    const keywordsArr = keywords.split('\n');
    let itemNum = keywordsArr.length;

    // we have to limit length of input
    do {
      prompt = promptTemplate;
      for (const name of Object.keys(args)) {
        prompt = prompt.replaceAll(
          '{' + name + '}',
          args[name] === undefined || args[name] === null ? '' : args[name]
        );
      }
      prompt = prompt.replace('{KEYWORDS}', keywords);
      itemNum -= 1;
      if (itemNum === 0) {
        break;
      }
      // remove the last keyword and repeat
      keywords = keywordsArr.slice(0, itemNum - 1).join('\n');
      if (itemNum < keywordsArr.length - 1) {
        Logger.log(`request is too long (${prompt.length}), shortening`);
      }
    } while (prompt.length >= Config.vertexAi.maxRequestLength);
    return prompt;
  }
}
