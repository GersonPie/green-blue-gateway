const express = require('express')
const cors = require('cors')
require('dotenv').config()


//globals
const api = express()
const PORT = process.env.PORT || 8001;
const APPNAME = process.env.NAME || "container"

//api
api.get('/name', (req,res)=>{
    res.json({name: APPNAME})
})

//engine
api.listen(PORT, ()=>{

    console.log('system running on port ', PORT)
})