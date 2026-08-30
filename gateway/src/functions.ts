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