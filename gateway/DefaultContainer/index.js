const express = require('express')
const cors = require('cors')
require('dotenv').config()


//globals
const api = express()
const PORT = process.env.PORT || 8001;
const name = process.env.NAME || "no name";

//api
api.get('/name', (req,res)=>{
    res.json({name})
})

//engine
api.get('/health', (_req, res) => res.json({ ok: true }));
const server = api.listen(Number(PORT), process.env.HOST || '127.0.0.1', ()=>{

    console.log('system running on port ', PORT)
})
server.on('error', (error) => { console.error(error); process.exit(1); });
process.on('SIGTERM', () => server.close(() => process.exit(0)));
process.on('SIGINT', () => server.close(() => process.exit(0)));
process.on('disconnect', () => server.close(() => process.exit(0)));
