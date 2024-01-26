import { Predictor } from './app';

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
export const SETTINGS = {
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
};

export const Config = {
  sheets: {
    Configuration: 'Configuration',
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

export class ConfigReader {
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

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  static setValue(name: string, value: any) {
    const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
      Config.sheets.Configuration
    );
    if (!sheet) return '';
    const values = sheet.getRange(1, 1, sheet.getLastRow(), 2).getValues();
    for (let i = 0; i < values.length; i++) {
      const row = values[i];
      if (row[0].toLowerCase() === name.toLowerCase()) {
        sheet.getRange(i + 1, 2).setValue(value);
      }
    }
  }
}

export function reset_configuration() {
  let sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(
    Config.sheets.Configuration
  );
  if (!sheet) {
    sheet = SpreadsheetApp.getActiveSpreadsheet().insertSheet(
      Config.sheets.Configuration
    );
  }
  const values = [
    [
      SETTINGS.CID,
      '',
      'Google Ads customer id (MCC or leaf) to fetch data from',
    ],
    [SETTINGS.MCC, '', 'Google Ads MCC account id'],
    [SETTINGS.ADS_DEV_TOKEN, '', 'Google Ads developer token'],
    [
      SETTINGS.CLOUD_PROJECT_ID,
      '',
      'Google Cloud project id with enabled Vertex AI API',
    ],
    [
      SETTINGS.CLOUD_PROJECT_REGION,
      'us-central1',
      'Google Cloud project region (us-central1 by default)',
    ],
    [SETTINGS.CUSTOMER_NAME, '', 'Customer name to substitute into prompts'],
    [
      SETTINGS.LLM_temperature,
      0.4,
      'The temperature is used for sampling during the response generation, which occurs when topP and topK are applied. Temperature controls the degree of randomness in token selection. Default: 0.9',
    ],
    [
      SETTINGS.LLM_topK,
      40,
      'Top-K changes how the model selects tokens for output. Specify a lower value for less random responses and a higher value for more random responses. Default: none',
    ],
    [
      SETTINGS.LLM_topP,
      0.8,
      'Top-P changes how the model selects tokens for output. Specify a lower value for less random responses and a higher value for more random responses. Default: 1.0',
    ],
    [
      SETTINGS.LLM_Prompt_Headlines,
      '',
      'Prompt for generating headlines. Leave blank for using the default. Support macros: CUSTOMER_NAME, KEYWORDS',
    ],
    [
      SETTINGS.LLM_Prompt_Headlines_Shorten,
      '',
      'Prompt for shortening headlines. Leave blank for using the default. Support macros: MIN, MAX, HEADLINES',
    ],
    [
      SETTINGS.LLM_Prompt_Descriptions,
      '',
      'Prompt for generating descriptions. Leave blank for using the default. Support macros: CUSTOMER_NAME, KEYWORDS, KEYWORDS',
    ],
    [
      SETTINGS.ADSEDITOR_add_long_headlines,
      'FALSE',
      'Use TRUE to add headlines longer than the limit in generated sheet for Google Ads (will require manual adjastment before publishing to Ads)',
    ],
    [
      SETTINGS.ADSEDITOR_add_long_descriptions,
      'FALSE',
      'Use TRUE to add descriptions longer than the limit in generated sheet for Google Ads (will require manual adjastment before publishing to Ads)',
    ],
    [
      SETTINGS.ADSEDITOR_add_generic_headlines,
      '',
      'A range to take generic headlines from, e.g. Data!A1:A20 ("Date" is the name of sheet)',
    ],
    [
      SETTINGS.ADSEDITOR_add_generic_descriptions,
      '',
      'A range to take generic descriptions from, e.g. Data!C1:C20 ("Date" is the name of sheet)',
    ],
    [SETTINGS.LOGGING, 'TRUE', ''],
  ];
  sheet?.getRange(1, 1, values.length, values[0].length).setValues(values);
}

export function reveal_prompts() {
  ConfigReader.setValue(
    SETTINGS.LLM_Prompt_Headlines,
    Predictor.DEFAULT_PROMPT_HEADLINES
  );
  ConfigReader.setValue(
    SETTINGS.LLM_Prompt_Headlines_Shorten,
    Predictor.DEFAULT_PROMPT_HEADLINES_SHORTEN
  );
  ConfigReader.setValue(
    SETTINGS.LLM_Prompt_Descriptions,
    Predictor.DEFAULT_PROMPT_DESCRIPTIONS
  );
}
