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
import { Predictor } from '../src/app';
import { GeminiVertexApi } from '../src/vertex-api';
import { ConfigMockReader } from './mocks';

// Mocking global Logger object in Apps Script environment:
const Logger: GoogleAppsScript.Base.Logger = {
  clear() {},
  getLog() {
    return 'test';
  },
  log(format: string, ...values: any[]) {
    console.log(format, values);
    return this;
  },
};
global.Logger = Logger;

describe('parsing', () => {
  it('json response as code block', () => {
    const resText = `\`\`\` JSON
["headline1", "headline2"]
\`\`\`
`;
    const api = new GeminiVertexApi('', new ConfigMockReader());
    const predictor = new Predictor(api, '');
    const res = predictor._normalizeReply(resText);
    expect(res).toEqual(['headline1', 'headline2']);
  });

  it('json response as text', () => {
    const resText = `["headline1", "headline2"]`;
    const api = new GeminiVertexApi('', new ConfigMockReader());
    const predictor = new Predictor(api, '');
    const res = predictor._normalizeReply(resText);
    expect(res).toEqual(['headline1', 'headline2']);
  });
});
