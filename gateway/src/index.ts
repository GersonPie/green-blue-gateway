import Express from "express";
import dotenv from "dotenv"
import cors from 'cors'
import {check_running_apps, run_command} from './system.ts'
import { Log } from "./functions.ts";

//config api gateway
dotenv.config();
const api = Express()
//////////////////////////////////

//globals
export const PORT = process.env.PORT || 8000;
export const _STARTING_PORT = 8001;
export const _MAX_CONTAINERS = 10;
export const _BASE_URL = process.env.BASE_URL || 'http://localhost:' //the base url without port 

/////////////////////////////////


api.use(Express.json())

api.use(cors())

api.get('/', async (req, res) => {
    new Log('request received')
    const running_apps = await check_running_apps()
    res.json({ok: true, running_apps})
})



api.post('/start', async(req,res)=>{
    const { engine, containerId, port} = req.body


    if(engine){
        const command_response = await run_command(`pm2 start ../${containerId}/index.js --name container:${port}`)
        Log.system(`${containerId} started`)
        return res.json({command_response})
        
    }
    else{
        const command_response = await run_command(`pm2 stop container:${port}`)
        Log.system(`${containerId} stopped`)
        
        return res.json({command_response})
        
    }


})
//engine 
api.listen(PORT, (err) => {

    if (err) return console.log(err)
    console.log(`[gateway] - running on ${_BASE_URL}${PORT}/`)
})
///////////////////////////////////
