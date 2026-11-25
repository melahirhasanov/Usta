const Master=require("../models/Master")

const getNearestMaster=async(req,res)=>{
    // GET sorğusunda body olmur, ona görə koordinatlar query-dən oxunur
    const {latitude,longitude,maxDistance}=req.query
    const lat=parseFloat(latitude)
    const lng=parseFloat(longitude)
if(Number.isNaN(lat)||Number.isNaN(lng)){
    return res.status(400).json({error:"Kordinatlar teleeb olunur"})

}
try{
    const ustalar=await Master.find({
        location:{
            $near:{
                $geometry:{
                    type:"Point",
                    coordinates:[lng,lat]

                },
                $maxDistance: parseInt(maxDistance) || 10000
            }
        }
    }).select("-password -phone -resetPasswordToken -resetPasswordExpires -followers -following")
    res.json(ustalar)
}catch(error){ res.status(500).json({error:"Yaxın ustalar tapılmadı",details:error.message})
}
}
module.exports={getNearestMaster}