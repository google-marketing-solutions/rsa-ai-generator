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

import { app } from './app';
import { clientside } from './client';

app;
clientside;

/**
 * The only function that is needed to be called in client project
 * @sample onOpen('lib') where lib is the name under which the library is imported in client project
 */
function onOpen(var_name: string) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  ss.addMenu('RSA AI Generator', [
    {
      name: 'Fetch keywords',
      functionName: var_name + '.fetch_keywords',
    },
    {
      name: ' - Generate headlines/descriptions via AI (option 1)',
      functionName: var_name + '.generate_rsa',
    },
    {
      name: ' - Open sidebar with generation interface (option 2)',
      functionName: var_name + '.open_sidebar',
    },
    {
      name: ' - - Generate data for Google Ads Editor',
      functionName: var_name + '.generate_ads_editor',
    },
    {
      name: ' - Generate customizer feed for Google Ads',
      functionName: var_name + '.generate_customizer_feed',
    },
    null,
    {
      name: 'Enter Ads developer token',
      functionName: var_name + '.enter_dev_token',
    },
    {
      name: 'DEBUG: Generate headlines/descriptions for the selected row',
      functionName: var_name + '.generate_rsa_current_row',
    },
    {
      name: 'Reset configuration',
      functionName: var_name + '.reset_configuration',
    },
    {
      name: 'Reveal prompts',
      functionName: var_name + '.reveal_prompts',
    },
    {
      name: 'Reveal safety settings',
      functionName: var_name + '.reveal_safetySettings',
    },
  ]);
}
