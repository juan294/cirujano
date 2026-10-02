import { createHash } from 'node:crypto';
import { chmod, lstat, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalJson, jsonDigest, parseStrictJson, safePath, sha256 } from './harness.mjs';
export { dependencyStoreDigest } from './harness.mjs';
const hash=/^[a-f0-9]{64}$/,sha=/^[a-f0-9]{40}$/,version=/^\d+\.\d+\.\d+$/;
function rejectPreparationCredentials(text) {
 if(Buffer.byteLength(text)>4*1024*1024) throw Error('image-context-dependency-input-size');
 let decoded=text;for(let pass=0;pass<2;pass++){try{decoded=decodeURIComponent(decoded);}catch{break;}}
 const secretQuery=/(?:[?&;])(?:access[_-]?token|auth(?:orization)?|api[_-]?key|key|token|signature|sig|secret|password|credential|x-amz-(?:credential|signature)|x-goog-(?:credential|signature))\s*=/i;
 for(const match of decoded.matchAll(/(?:https?|git\+https?):\/\/[^\s"'<>]+/gi)) if(/^(?:https?|git\+https?):\/\/[^/]*@/i.test(match[0])||secretQuery.test(match[0])) throw Error('image-context-credential-dependency-unsupported');
 if(/(?:^|\n)\s*["']?(?:_?auth(?:token)?|authorization|_?password|username|token(?:helper)?|api[_-]?key|secret)["']?\s*[:=]/i.test(decoded)) throw Error('image-context-credential-config-unsupported');
}
function rejectCodePreparation(text) {
 if(/(?:(?<![\w@./-])(?:git(?:\+[a-z]+)?|github|gitlab|bitbucket|file|link|patch):|(?<![\w@./-])git@|(?:^|\n)\s*(?:patchedDependencies|repo|directory)\s*:|\btype\s*:\s*["']?(?:git|directory)\b)/i.test(text)) throw Error('image-context-code-dependency-unsupported');
}
function object(value,keys) {if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).sort().join('|')!==[...keys].sort().join('|')) throw Error('image-context-object-fields');}
function match(value,pattern) {if(typeof value!=='string'||!pattern.test(value)) throw Error('image-context-invalid-identity');}
function validateSource(source) {
 canonicalJson(source);object(source,['schemaVersion','provenance','profilePath','files']);if(source.schemaVersion!==1||!Array.isArray(source.files)||!source.files.length||source.files.length>5000) throw Error('image-context-source');
 const p=source.provenance;object(p,['repositoryId','repository','baseSha','workflowBlobSha','workflowPath','workflowHash','jobId','stepIndex','lockfileHash','sourceTreeDigest','verificationProfileHash','toolSourceSha','bundleDigest']);
 if(!Number.isSafeInteger(p.repositoryId)||p.repositoryId<1||!Number.isSafeInteger(p.stepIndex)||p.stepIndex<0||typeof p.jobId!=='string'||!p.jobId) throw Error('image-context-source-identity');match(p.repository,/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/);for(const key of ['baseSha','workflowBlobSha','toolSourceSha']) match(p[key],sha);for(const key of ['workflowHash','lockfileHash','sourceTreeDigest','verificationProfileHash','bundleDigest']) match(p[key],hash);safePath(p.workflowPath);safePath(source.profilePath);
 const seen=new Set();let total=0;
 for(const file of source.files){object(file,['path','mode','hash','bytesBase64']);safePath(file.path);if(seen.has(file.path)||!['100644','100755'].includes(file.mode)||file.path.split('/').includes('.git')||/(?:^|\/)(?:\.env(?:\..*)?|\.npmrc|credentials(?:\..*)?|id_rsa|id_ed25519|[^/]*\.(?:pem|key))$/.test(file.path)) throw Error('image-context-unsafe-source');seen.add(file.path);match(file.hash,hash);if(typeof file.bytesBase64!=='string'||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.bytesBase64)) throw Error('image-context-base64');const bytes=Buffer.from(file.bytesBase64,'base64');total+=bytes.length;if(bytes.length>4*1024*1024||total>16*1024*1024||bytes.toString('base64')!==file.bytesBase64||sha256(bytes)!==file.hash) throw Error('image-context-source-hash');}
 for(const path of seen) for(let depth=1;depth<path.split('/').length;depth++) if(seen.has(path.split('/').slice(0,depth).join('/'))) throw Error('image-context-path-collision');
 const workflow=source.files.find(file=>file.path===p.workflowPath),lock=source.files.find(file=>file.path==='pnpm-lock.yaml'),profile=source.files.find(file=>file.path===source.profilePath);
 if(!workflow||!lock||!profile||workflow.hash!==p.workflowHash||lock.hash!==p.lockfileHash||profile.hash!==p.verificationProfileHash) throw Error('image-context-provenance-drift');
 const bytes=Buffer.from(workflow.bytesBase64,'base64'),blobSha=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');if(blobSha!==p.workflowBlobSha) throw Error('image-context-workflow-blob-drift');
 const metadata=source.files.filter(file=>file.path!==p.workflowPath).map(({path,mode,hash})=>({path,mode,hash})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);if(jsonDigest(metadata)!==p.sourceTreeDigest) throw Error('image-context-tree-drift');
 return source;
}
function validateRecipe(recipe,source) {
 object(recipe,['schemaVersion','kind','from','nodeVersion','pnpmVersion','toolSourceSha','bundleDigest']);
 if(recipe.schemaVersion!==1||recipe.kind!=='image-recipe') throw Error('image-context-recipe');match(recipe.from,/^[a-z0-9][a-z0-9./:_-]*@sha256:[a-f0-9]{64}$/);match(recipe.nodeVersion,version);match(recipe.pnpmVersion,version);match(recipe.toolSourceSha,sha);match(recipe.bundleDigest,hash);
 if(recipe.toolSourceSha!==source.provenance.toolSourceSha||recipe.bundleDigest!==source.provenance.bundleDigest) throw Error('image-context-tool-drift');
 const profileFile=source.files.find(file=>file.path===source.profilePath),profile=parseStrictJson(Buffer.from(profileFile.bytesBase64,'base64').toString('utf8'));
 if(profile.schemaVersion!==1||profile.nodeVersion!==recipe.nodeVersion||profile.pnpmVersion!==recipe.pnpmVersion) throw Error('image-context-runtime-drift');
}
function packageManifest(file) {
 const original=parseStrictJson(Buffer.from(file.bytesBase64,'base64').toString('utf8'),4*1024*1024);if(!original||typeof original!=='object'||Array.isArray(original)) throw Error('image-context-package-manifest');
 const allowed=['name','version','private','type','packageManager','dependencies','devDependencies','optionalDependencies','peerDependencies','peerDependenciesMeta','engines','os','cpu'];
 const result=Object.fromEntries(Object.entries(original).filter(([key])=>allowed.includes(key)));
 rejectPreparationCredentials(canonicalJson(result));rejectCodePreparation(canonicalJson(result));
 for(const field of ['dependencies','devDependencies','optionalDependencies','peerDependencies']) if(result[field]) {if(typeof result[field]!=='object'||Array.isArray(result[field])) throw Error('image-context-package-dependencies');for(const value of Object.values(result[field])) {if(typeof value!=='string'||/^(?:file|link):/.test(value)) throw Error('image-context-local-dependency-unsupported');if(/(?:https?|git\+https?):\/\/[^/\s]*@/.test(value)) throw Error('image-context-authenticated-dependency-unsupported');}}
 return canonicalJson(result)+'\n';
}
const buildManifest=`import { readFile, writeFile } from 'node:fs/promises';
import { canonicalJson, dependencyStoreDigest, jsonDigest, parseStrictJson, sha256 } from './harness.mjs';
const recipe=parseStrictJson(await readFile('/opt/cirujano/recipe.json','utf8'));
const manifest={schemaVersion:1,kind:'optimization-image',toolSourceSha:recipe.toolSourceSha,bundleDigest:recipe.bundleDigest,nodeVersion:recipe.nodeVersion,pnpmVersion:recipe.pnpmVersion,lockfileHash:sha256(await readFile('/opt/cirujano/dependency-input/pnpm-lock.yaml')),dependencyStoreHash:await dependencyStoreDigest('/opt/cirujano/store'),harnessHash:sha256(await readFile('/opt/cirujano/harness.mjs')),recipeHash:jsonDigest(recipe)};
await writeFile('/opt/cirujano/image.json',canonicalJson(manifest),{mode:0o600,flag:'wx'});
`;
/** Preparation only. The owner separately approves/verifies FROM and build/import receipts. */
export async function generateImageContext(source,recipe,output) {
 validateSource(source);validateRecipe(recipe,source);
 const lockBytes=Buffer.from(source.files.find(file=>file.path==='pnpm-lock.yaml').bytesBase64,'base64');
 rejectPreparationCredentials(lockBytes.toString('utf8'));rejectCodePreparation(lockBytes.toString('utf8'));
 if(typeof output!=='string'||!isAbsolute(output)||await realpath(dirname(output))!==resolve(dirname(output))) throw Error('image-context-output-path');
 try {await lstat(output);throw Error('image-context-output-exists');}catch(error){if(error.code!=='ENOENT') throw error;}
 const files=new Map();const harness=await readFile(new URL('./harness.mjs',import.meta.url));
 files.set('harness.mjs',harness);files.set('recipe.json',Buffer.from(canonicalJson(recipe)));files.set('build-manifest.mjs',Buffer.from(buildManifest));
 const packages=source.files.filter(file=>file.path==='package.json'||file.path.endsWith('/package.json'));if(!packages.some(file=>file.path==='package.json')) throw Error('image-context-root-package-required');
 for(const file of packages) files.set(`dependency-input/${file.path}`,Buffer.from(packageManifest(file)));
 files.set('dependency-input/pnpm-lock.yaml',Buffer.from(source.files.find(file=>file.path==='pnpm-lock.yaml').bytesBase64,'base64'));
 const docker=`FROM ${recipe.from}
USER root
ENV npm_config_ignore_scripts=true npm_config_ignore_pnpmfile=true
RUN node -e 'if(process.versions.node!=="${recipe.nodeVersion}") process.exit(1)' && npm install --global --ignore-scripts --no-audit --no-fund pnpm@${recipe.pnpmVersion} && test "$(pnpm --version)" = "${recipe.pnpmVersion}"
COPY --chmod=600 dependency-input/ /opt/cirujano/dependency-input/
COPY --chmod=600 harness.mjs recipe.json build-manifest.mjs /opt/cirujano/
WORKDIR /opt/cirujano/dependency-input
RUN pnpm fetch --store-dir /opt/cirujano/store --ignore-scripts --ignore-pnpmfile
RUN node /opt/cirujano/build-manifest.mjs
RUN chmod -R a+rX,a-w /opt/cirujano
RUN mkdir -p /workspace && chown 65534:65534 /workspace && chmod 700 /workspace
WORKDIR /workspace
`;
 files.set('Dockerfile',Buffer.from(docker));
 await mkdir(output,{mode:0o700});await chmod(output,0o700);
 for(const [path,bytes] of files){await mkdir(dirname(join(output,path)),{recursive:true,mode:0o700});await writeFile(join(output,path),bytes,{mode:0o600,flag:'wx'});}
 const inventory=[...files].map(([path,bytes])=>({path,hash:sha256(bytes)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 return {output,files:inventory.map(file=>file.path),recipeHash:jsonDigest(recipe),contextDigest:jsonDigest(inventory),harnessHash:sha256(harness),lockfileHash:source.provenance.lockfileHash};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 try {if(process.argv.length!==5) throw Error('image-context-usage');const source=parseStrictJson(await readFile(process.argv[2],'utf8'),32*1024*1024),recipe=parseStrictJson(await readFile(process.argv[3],'utf8'));const result=await generateImageContext(source,recipe,process.argv[4]);process.stdout.write(canonicalJson(result)+'\n');}
 catch(error){process.stderr.write((error instanceof Error&&/^image-context-[a-z-]+$/.test(error.message)?error.message:'image-context-failed')+'\n');process.exitCode=1;}
}
