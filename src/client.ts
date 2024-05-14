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
/*
 Copyright 2024 Google LLC

 Licensed under the Apache License, Version 2.0 (the "License");
 you may not use this file except in compliance with the License.
 You may obtain a copy of the License at

      https://www.apache.org/licenses/LICENSE-2.0

 Unless required by applicable law or agreed to in writing, software
 distributed under the License is distributed on an "AS IS" BASIS,
 WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 See the License for the specific language governing permissions and
 limitations under the License.
 */

import { generate_rsa } from './app';

export const clientside = null;

export function include(filename: string) {
  return HtmlService.createTemplateFromFile(filename).evaluate().getContent();
}

/* eslint-disable @typescript-eslint/no-explicit-any */
export function onClientCall(this: any, func: string, arg: any) {
  return (<any>this)[func](arg);
}

export function get_sheet_state_ui() {
  const sheet = SpreadsheetApp.getActiveSheet();
  const response = JSON.stringify({
    sheetName: sheet.getName(),
    lastRow: sheet.getLastRow(),
  });
  Logger.log('get_sheet_state_ui: ' + response);
  return response;
}

export function generate_rsa_ui(input: string) {
  console.log('generate_rsa_ui: stating job: ' + input);
  const job = JSON.parse(input);
  job.started = new Date();
  try {
    generate_rsa(job);
  } catch (error) {
    console.log(error);
    job.error = error;
    throw JSON.stringify(job);
  } finally {
    job.ended = new Date();
  }
  console.log('generate_rsa_ui: job completed: ' + input);
  return JSON.stringify(job);
}
