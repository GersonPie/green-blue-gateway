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
api.listen(PORT, (error)=>{

    console.log('system running on port ', PORT)
    if(error){
        console.log('error', error)
    }
})