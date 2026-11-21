const express=require("express")
const {getNearestMaster} =require("../rs/Controllers")
const router=express.Router()
router.get("/nearest-masters",getNearestMaster)
module.exports=router
