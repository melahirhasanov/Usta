import { createSlice } from "@reduxjs/toolkit";
import axios from "axios";

const initialState = {
  user: null,
  token: null,
  loading: false,
  error: null,
  isAuthenticated:false,
  isRegistered:false
};

const authSlice = createSlice({
  name: "auth",
  initialState,
  reducers: {
    startLoading: (state) => {
      state.loading = true;
      state.error = null;
      state.isAuthenticated=false
      state.isRegistered=false
    },
    loginSuccess: (state, action) => {
      state.loading = false;
      state.user = action.payload.user;
      state.token = action.payload.token;
      localStorage.setItem("token", action.payload.token);
      state.isAuthenticated=true
      state.isRegistered=false
    },
    registerSuccess: (state) => {
      state.loading = false;
      state.isRegistered=true
    },
    authFail: (state, action) => {
      state.loading = false;
      state.error = action.payload;
      state.isRegistered=false
    },
    logout: (state) => {
      state.user = null;
      state.token = null;
      localStorage.removeItem("token");
      state.isAuthenticated=false,
      state.isRegistered=true
    },
  },
});

export const { startLoading, loginSuccess, registerSuccess, authFail, logout } = authSlice.actions;
export default authSlice.reducer;

// ✅ Async login funksiyası düzəliş edilib
export const login = ({email, password}) => async (dispatch) => {
  dispatch(startLoading());
  try {
    const response = await axios.post(
      "http://localhost:8080/api/auth/login",
      { email, password },
      { headers: { "Content-Type": "application/json" } } // Burada JSON olduğunu bildiririk
    );
    
    dispatch(loginSuccess(response.data));
  } catch (error) {
    dispatch(authFail(error.response?.data?.message || "Login Failed"));
  }
};

export const register = (userData) => async (dispatch) => {
  dispatch(startLoading());
  try {
    await axios.post("http://localhost:8080/api/auth/register", userData);
    dispatch(registerSuccess());
  } catch (error) {
    dispatch(authFail(error.response?.data?.message || "Registration Failed"));
  }
};
