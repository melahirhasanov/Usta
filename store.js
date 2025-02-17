import {configureStore} from "@reduxjs/toolkit"
import authReducer from "../Server/features/authSlice"
 const store=configureStore({
    reducer:{
        auth:authReducer
    }
 })
 export default store