export type CodeLanguage='curl'|'javascript'|'python'|'php'|'csharp'

export const integrationEndpoint='https://tffgvfovlpurxmkqkwwq.supabase.co/functions/v1/chat'
export const codeLanguages:CodeLanguage[]=['curl','javascript','python','php','csharp']
export const codeLabel:Record<CodeLanguage,string>={curl:'cURL',javascript:'JavaScript',python:'Python',php:'PHP',csharp:'C#'}

export const scalarValue=(value:string):unknown=>{
  const clean=value.trim()
  if(clean==='true')return true
  if(clean==='false')return false
  if(clean==='null')return null
  if(clean!==''&&Number.isFinite(Number(clean)))return Number(clean)
  if((clean.startsWith('{')&&clean.endsWith('}'))||(clean.startsWith('[')&&clean.endsWith(']'))){try{return JSON.parse(clean)}catch{/* Keep invalid JSON as text so the user can see exactly what will be sent. */}}
  return value
}

const pretty=(value:unknown)=>JSON.stringify(value,null,2)
const shellSingleQuote=(value:string)=>value.replace(/'/g,"'\"'\"'")

export function integrationSnippet(language:CodeLanguage,payload:Record<string,unknown>){
  const body=pretty(payload)
  if(language==='curl')return `curl -X POST '${integrationEndpoint}' \\
  -H 'Authorization: Bearer ai_live_YOUR_API_KEY' \\
  -H 'Content-Type: application/json' \\
  --data '${shellSingleQuote(body)}'`
  if(language==='javascript')return `const response = await fetch('${integrationEndpoint}', {
  method: 'POST',
  headers: {
    Authorization: 'Bearer ai_live_YOUR_API_KEY',
    'Content-Type': 'application/json',
  },
  body: JSON.stringify(${body}),
})

const result = await response.json()
console.log(result)`
  if(language==='python')return `import json
import requests

payload = json.loads(${JSON.stringify(body)})
response = requests.post(
    '${integrationEndpoint}',
    headers={
        'Authorization': 'Bearer ai_live_YOUR_API_KEY',
        'Content-Type': 'application/json',
    },
    json=payload,
    timeout=60,
)
print(response.json())`
  if(language==='php')return `<?php
$json = <<<'JSON'
${body}
JSON;
$payload = json_decode($json, true, 512, JSON_THROW_ON_ERROR);
$ch = curl_init('${integrationEndpoint}');
curl_setopt_array($ch, [
  CURLOPT_POST => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Authorization: Bearer ai_live_YOUR_API_KEY',
    'Content-Type: application/json',
  ],
  CURLOPT_POSTFIELDS => json_encode($payload, JSON_UNESCAPED_UNICODE),
]);
$response = curl_exec($ch);
curl_close($ch);
echo $response;`
  return `using System.Net.Http.Headers;
using System.Text;

using var client = new HttpClient();
client.DefaultRequestHeaders.Authorization =
    new AuthenticationHeaderValue("Bearer", "ai_live_YOUR_API_KEY");

var json = """
${body}
""";
var response = await client.PostAsync(
    "${integrationEndpoint}",
    new StringContent(json, Encoding.UTF8, "application/json")
);
Console.WriteLine(await response.Content.ReadAsStringAsync());`
}
