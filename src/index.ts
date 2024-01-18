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
// import {
//   fetch_keywords,
//   generate_rsa,
//   generate_ads_editor,
//   generate_rsa_current_row,
// } from './app';
import { app } from './app';

app;

/**
 * The only function that is needed to be called in client project
 * @sample onOpen('lib') where lib is the name under which the library is imported in client project
 */
function onOpen(var_name: string) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.addMenu('AI-generative RSA', [
    { name: 'Fetch keywords', functionName: var_name + '.fetch_keywords' },
    {
      name: 'Generate headlines/descriptions via AI',
      functionName: var_name + '.generate_rsa',
    },
    {
      name: 'Generate data for Google Ads Editor',
      functionName: var_name + '.generate_ads_editor',
    },
    null,
    {
      name: 'DEBUG: Generate headlines/descriptions for current row',
      functionName: var_name + '.generate_rsa_current_row',
    },
    //{name: 'Show prompt'}
  ]);
}
