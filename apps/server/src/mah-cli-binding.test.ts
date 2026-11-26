import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolveMahCliBinding, MAH_PUBLIC_MACOS_COMMAND } from './mah-cli-binding.js';
import { productionReadiness } from './production-readiness.js';
import { assertMahMaterializationContract } from './mah-materialization-contract.js';

test('ordinary installation uses public app wrapper without private runtime variables',()=>{
  const binding=resolveMahCliBinding({PATH:'/fiction/bin'});
  assert.equal(binding.command,MAH_PUBLIC_MACOS_COMMAND);
  assert.equal(binding.environment.MAH_TASK_CLI_EXECUTABLE,undefined);
  assert.equal(binding.environment.MAH_TASK_CLI_MAIN,undefined);
});
test('explicit command precedence and existing Task binding are preserved',()=>{
  const env={LANDI_MAH_CLI_COMMAND:'/fiction/landi-mah',MAH_TASK_CLI_COMMAND:'/fiction/task-mah',MAH_TASK_CLI_EXECUTABLE:'/fiction/node',MAH_TASK_CLI_MAIN:'/fiction/main.js'};
  const b=resolveMahCliBinding(env);assert.equal(b.command,env.MAH_TASK_CLI_COMMAND);assert.deepEqual(b.environment,env);
  b.environment.MAH_TASK_CLI_MAIN='/changed';assert.equal(env.MAH_TASK_CLI_MAIN,'/fiction/main.js');
});
test('partial or relative legacy bindings reject instead of silently falling back',()=>{
  for(const e of [{MAH_TASK_CLI_EXECUTABLE:'/fiction/node'},{MAH_TASK_CLI_MAIN:'/fiction/main.js'},
    {MAH_TASK_CLI_EXECUTABLE:'node',MAH_TASK_CLI_MAIN:'/fiction/main.js'},
    {MAH_TASK_CLI_EXECUTABLE:'/fiction/node',MAH_TASK_CLI_MAIN:'main.js'}])assert.throws(()=>resolveMahCliBinding(e),/命令配置无效/);
});
test('relative empty and NUL command paths reject',()=>{
  for(const command of ['mah','', '/fiction/mah\0'])assert.throws(()=>resolveMahCliBinding({LANDI_MAH_CLI_COMMAND:command}));
});
test('Task 绑定优先于 Landi 配置',()=>{
  const b=resolveMahCliBinding({LANDI_MAH_CLI_EXECUTABLE:'/fiction/new-node',LANDI_MAH_CLI_MAIN:'/fiction/new-main',MAH_TASK_CLI_EXECUTABLE:'/fiction/old-node',MAH_TASK_CLI_MAIN:'/fiction/old-main'});
  assert.equal(b.environment.MAH_TASK_CLI_EXECUTABLE,'/fiction/old-node');assert.equal(b.environment.MAH_TASK_CLI_MAIN,'/fiction/old-main');
});
test('canonical transport uses resolver; materialization and production gates remain closed',()=>{
  assert.match(readFileSync(new URL('./mah-cli-transport.ts',import.meta.url),'utf8'),/resolveMahCliBinding\(this.environment\)/);
  assert.throws(assertMahMaterializationContract,/物化核验/);
  for(const k of ['generation','conversation','revision','hosting','unattendedEmail'] as const)assert.equal(productionReadiness()[k],false);
});

test('Task 的空 APP 与终止符保持原字节',()=>{const e={MAH_TASK_CLI_COMMAND:'/受控/mah',MAH_TASK_CLI_EXECUTABLE:'/受控/MAH',MAH_TASK_CLI_MAIN:'/受控/main.js',MAH_TASK_CLI_APP:'',MAH_TASK_CLI_TERMINATOR:'--'};assert.deepEqual(resolveMahCliBinding(e).environment,e);});
