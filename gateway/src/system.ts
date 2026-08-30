import { exec, execSync, spawn, spawnSync } from 'node:child_process';
import { _STARTING_PORT, _MAX_CONTAINERS, _BASE_URL } from './index.js';
import { promisify } from 'node:util';

interface RunningApps {
    name: unknown;
    port: number;
}

export const check_running_apps = async () => {
    Log.system('running check_running_apps()');
    
    const running_apps: RunningApps[] = [];

    for (let i = 0; i < _MAX_CONTAINERS; i++) {

        const port = _STARTING_PORT + i;

    

        try {
            const response = await fetch(
                `${_BASE_URL}${port}/name`
            );

            if (response.ok) {
                const data = await response.json();
                
                running_apps.push({
                    port,
                    ...data
                });
            }

            else {
                Log.system(`${port} is offline`)
            }
        } catch (err) {
            Log.error(
                'system.ts',
                `error occurred while fetching ${_BASE_URL}${port}/name`
            );
        }
    }
    Log.system(`👍found ${running_apps.length} running containers`)
    running_apps.map((app)=>{
        return Log.system(`name: ${app.name} | PORT: ${app.port}`)
    })
    const pm2log = await run_command('pm2 log')
    const pm2status = await run_command('pm2 status')
    return {pm2log,running_apps, pm2status};
};


export const run_command = async (command:string)=>{
   const execAsync = promisify(exec)

    // const child = await execAsync(`${command}`)
    
    const child = await execAsync(`${command}`)
    
    if(child.stderr)Log.error('system.ts', child.stderr)
    
    Log.system(child.stdout) 
    return child.stdout
}




export class Container{
    
    public processId:number = 0;
    public port:number = 0;
    public container:any = {};

    public constructor(name: string){
        this.container.port =this.port
        this.container.processId = this.processId
        this.container = name;

        return this.container;
    }
    static start(){
        
    }
    static stop(){

    }
    static check(){

    }



}




export const getDate = ()=>{
    const date = new Date();

    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0'); // Months are 0-indexed
    const day = String(date.getDate()).padStart(2, '0');
    const hours = String(date.getHours()).padStart(2, '0');
    const minutes = String(date.getMinutes()).padStart(2, '0');
    const seconds = String(date.getSeconds()).padStart(2, '0');
    const formated = `${year}-${month}-${day} ${hours}:${minutes}`
    return`[${formated}]: > `
}



export class Log{

    constructor(log: string){
        console.log(`${getDate()}: > ${log}`);
    }

    static system = (text: string)=>{
        const formatedlog = `${getDate()} - [system]: > ${text}`
        return console.log(formatedlog)
    }

   static error = (filename:string, text: string)=>{
        const formatedlog = `${getDate()} - [error]${filename}: >${text}`
        return formatedlog
    }
    


}