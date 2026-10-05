import { defineConfig, loadEnv } from 'vite';
import config from './deployment.json' with {type:'json'};
export default defineConfig(({mode})=>{
 const env={...loadEnv(mode,process.cwd(),''),...process.env};
 return {base:'./',build:{target:'es2022'},define:{
  'import.meta.env.VITE_SUPABASE_URL':JSON.stringify(env.VITE_SUPABASE_URL||config.supabaseUrl),
  'import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY':JSON.stringify(env.VITE_SUPABASE_PUBLISHABLE_KEY||config.supabasePublishableKey)
 }};
});
