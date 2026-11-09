import assert from 'node:assert/strict';
import {T, localeDict} from '../web/i18n.js';
import {WorkspaceProgress} from '../web/workspace_progress.js';

const saved = Object.fromEntries(['comfyAPI','app','navigator'].map(key => [key,Object.getOwnPropertyDescriptor(globalThis,key)]));
const settings = getLocale => ({ui:{settings:{getSettingValue(key) {
    assert.equal(key,'Comfy.Locale');
    return getLocale();
}}}});
try {
    delete globalThis.comfyAPI; delete globalThis.app;
    Object.defineProperty(globalThis,'navigator',{configurable:true,value:{language:'zh-CN',languages:['zh-CN']}});
    assert.equal(T('Adopt'),'Adopt','English remains the default even for a Chinese-language browser');
    assert.equal(localeDict(),null);
    assert.equal(T('Missing {count} model files',{count:0}),'Missing 0 model files');

    let locale='en-US';
    globalThis.comfyAPI={app:{app:settings(()=>locale)}};
    globalThis.app=settings(()=>'zh');
    assert.equal(T('Open Adachi Workbench'),'Open Adachi Workbench','the current ComfyUI API takes priority over legacy globals');
    locale='zh-CN';
    assert.equal(T('Open Adachi Workbench'),'打开安达工作台');
    assert.equal(T('Missing {count} model files',{count:3}),'缺少 3 份模型文件');
    assert.equal(T('Settings panel {width} pixels wide',{width:360}),'右侧配置 360 像素');
    assert.equal(T('Fill','enum'),'填充','existing enum contexts remain compatible');
    assert.equal(T('New message {count}',{count:false}),'New message false','untranslated strings still interpolate');
    assert.equal(T('Unknown {value} / {missing}',{value:'<img src=x>'}),'Unknown <img src=x> / {missing}','values remain literal text and missing placeholders remain visible');
    assert.equal(T('toString'),'toString','dictionary prototype properties are not translations');

    locale='zh_TW';
    assert.equal(T('Workflow connections'),'工作流连接','regional locale separators both resolve to the Chinese dictionary');
    const progress=new WorkspaceProgress();
    progress.begin({'7':{class_type:'AdachiWebUIInpaint'}},'task');
    progress.handle('progress',{prompt_id:'task',node:'7',value:2,max:10});
    assert.equal(progress.label,'重绘采样（K 采样器） · 2 / 10');
    locale='en';
    progress.handle('progress',{prompt_id:'task',node:'7',value:3,max:10});
    assert.equal(progress.label,'Inpaint sampling (KSampler) · 3 / 10','execution messages use the current setting rather than an import-time locale');
    assert.equal(T('Adopt'),'Adopt','locale changes do not require module reload');
    locale='fr';
    assert.equal(T('Adopt'),'Adopt','unsupported locales fall back to English');

    globalThis.comfyAPI={app:settings(()=>'zh')}; delete globalThis.app;
    assert.equal(T('Adopt'),'采用','older ComfyUI API shape is supported');
    globalThis.comfyAPI={app:{app:settings(()=>{throw Error('not initialized');})}};
    globalThis.app=settings(()=>'zh');
    assert.equal(T('Adopt'),'采用','a not-yet-ready modern setting can fall back to the legacy app');
    delete globalThis.comfyAPI; delete globalThis.app;
    assert.equal(T('Adopt'),'Adopt','an unavailable app does not break custom UI initialization');
} finally {
    for(const [key,descriptor] of Object.entries(saved)) {
        if(descriptor)Object.defineProperty(globalThis,key,descriptor);else delete globalThis[key];
    }
}
console.log('Localization: ComfyUI settings precedence, English fallback, live locale changes, placeholders, regional locales and enum compatibility pass');
