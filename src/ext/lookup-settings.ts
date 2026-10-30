import { DEFAULT_SETTINGS } from './lib.ts';

export const PASSIVE_MIGRATION='cf:passiveV33';
export const BACKGROUND_OPT_IN='cf:backgroundAllowedV33';

export async function readLookupSettings(chrome:any) {
  const g=await chrome.storage.local.get(['settings',PASSIVE_MIGRATION,BACKGROUND_OPT_IN]);
  return {...DEFAULT_SETTINGS,...g.settings,
    lookupMode:g[PASSIVE_MIGRATION]===true&&g[BACKGROUND_OPT_IN]===true&&g.settings?.lookupMode==='auto'?'auto' as const:'careful' as const};
}

// Old Auto settings and imported/synced documents cannot opt into background visits.
export async function initializeLookupSettings(chrome:any) {
  const g=await chrome.storage.local.get(['settings',PASSIVE_MIGRATION]);
  if(g[PASSIVE_MIGRATION]!==true)await chrome.storage.local.set({
    settings:{...DEFAULT_SETTINGS,...g.settings,lookupMode:'careful'},
    [PASSIVE_MIGRATION]:true,[BACKGROUND_OPT_IN]:false,'cf:lookupV32':true
  });
}

/** Called only by the visible mode selector. */
export async function setLookupMode(chrome:any, mode:string) {
  const g=await chrome.storage.local.get('settings'),auto=mode==='auto';
  await chrome.storage.local.set({settings:{...DEFAULT_SETTINGS,...g.settings,lookupMode:auto?'auto':'careful'},
    [PASSIVE_MIGRATION]:true,[BACKGROUND_OPT_IN]:auto,'cf:lookupV32':true});
}
