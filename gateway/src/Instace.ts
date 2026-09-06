import {existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { cp, rm } from 'node:fs/promises';
import  {freePort, Log, run_command} from './system.ts'
import { defaultRunnigContainersPath } from './index.ts';
export class Container{
    ContainerPath = "./DefaultContainer";
    name: string = "Default";
    repo: string = "";
    processId:number = 0;
    port:number = 0;
    //container:ContainerType = {container:{}, name: "Gerson", port: 8001, processId: 1, repo: '', check: ()=>{}, start: ()=>{}, stop: ()=>{}};
    constructor(name: string, repo?: string)
    {
        this.processId = this.processId;
        this.name = name;
        this.repo = repo || '';
    }

    async createDotEnv(){
        try{
            this.port = await freePort() || 0;
            writeFileSync(`${this.ContainerPath}/.env`, `PORT=${this.port}\nNAME=${this.name}`);
            new Log(`[CreateDotEnv] - Env has been created with [${this.port} - ${this.name}]`)
        }
        catch(err){
            new Log('[CreateDotEnv] - there was an Error Creating dotEnv ' + err)
        }
    }


    async start()
    {
        if(!existsSync(defaultRunnigContainersPath)){
            try{
                await mkdirSync(defaultRunnigContainersPath);
                new Log('[container.start()] - Created Default running containers folder')
            }
            catch(err){
                new Log('[container.start()] - failed to create default running containers folder')
            }
        }
        if(!this.repo.length){
            Log.system(`[container (${this.name})] - Initiating a new Instace from default container`)

            try{
                await this.createDotEnv()
                await cp(this.ContainerPath, `${defaultRunnigContainersPath}/${this.port}`, {recursive: true})
                new Log(`[container (${this.name})] - Container Created Successfully`)
                new Log(`[container (${this.name})] - is initiating ...`)
                await initiateInstace(this.port, defaultRunnigContainersPath, this.name)
                new Log(`[container (${this.name})] - is up running!`)
                
            }
            catch(err){
                Log.error('[container.start()]','failed create new instance '+ err)
            }
        }
        

    }
    stop(){

    }
    check(){
        
    }
}


export const  initiateInstace = async (port: number, default_RC: string, name: string)=>{
    try{
        await run_command(`cd ${default_RC}/${port} && npm i && pm2 start index.js --name ${name}`)


    }

    catch(err){
        Log.error('system.ts', `there was an error initiating app on port ${port}, deleting instance... ${err}`)
        try{
            await rm(`${default_RC}/${port}`, {recursive: true})
            new Log(`[initiateInstace] - instance id: ${port} deleted`);
        }
        catch(err){
            Log.error('system.ts initiateInstace', `there was an error deleting broken instance id ${port}, ${err}`)
        }


    }
}
