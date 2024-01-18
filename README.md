<!--
Copyright 2023 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

      http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# RSA AI Generator

# Problem Statement
Best practices for search ads recommend to create as many variations of headlines and descriptions as possible 
but that process can be cumbersome for customers. At the same time they usually already have a lot of keywords 
that can be used for generating headlines.


# Solution
A tool leveraging Google's LLMs to fill gaps in search campaigns setup by creating new headlines/descriptions 
for RSA from existing keywords.

# Deliverable (implementation)
This repository contains source code for an Apps Script library project. It's based on [ASIDE](https://github.com/google/aside) 
which in a turn based on [clasp](https://github.com/google/clasp).  
Thanks to those awesome libraries development can be done locally in TypeScript, transpiled to JavaScript and push a Apps Script project.


# Deployment
From the user's viewpoint the deployment starts with cloning the template Spreadsheet and 
doing some setup steps in it described in the following doc:

[Implementation Guide](https://docs.google.com/document/d/1jhosU5-nFFKpmZTZOM0OPdAi4mc_KuZN6L77jBOzx0M/edit) (publicly accessable, owned by gtech.cse.demos@gmail.com)


From the developer's viewpoint the deployment is updating an Apps Script library project with transpiled code.

To push code you need a `.clasp.json` file in the root folder. It's created by either `deploy` or `deploy:prod` npm commands 
from `.clasp-dev.json` and `.clasp-prod.json` respectadly. 
They are kept out of git to prevent accidental push. 

Example of `.clasp.json`:
```
{
  "scriptId":"1bl....",
  "rootDir":"./dist",
}
```

To use the library one must import it by a ScriptId of a library project (the one the code was pushed to) 
in an user Spreadsheet Apps Script project. It's already done in the template spreadsheet that can be used to start a new project
 - https://docs.google.com/spreadsheets/d/1iAYdhRDEZPhKgGfw8viYpiUPSC3P_K_L1hVEnF_oDwk/edit?usp=sharing


# Disclaimer
**This is not an officially supported Google product.**
Copyright 2023 Google LLC. This solution, including any related sample code or data, is made available on an “as is,” “as available,” and “with all faults” basis, solely for illustrative purposes, and without warranty or representation of any kind. This solution is experimental, unsupported and provided solely for your convenience. Your use of it is subject to your agreements with Google, as applicable, and may constitute a beta feature as defined under those agreements.  To the extent that you make any data available to Google in connection with your use of the solution, you represent and warrant that you have all necessary and appropriate rights, consents and permissions to permit Google to use and process that data.  By using any portion of this solution, you acknowledge, assume and accept all risks, known and unknown, associated with its usage, including with respect to your deployment of any portion of this solution in your systems, or usage in connection with your business, if at all.
