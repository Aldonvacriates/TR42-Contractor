import { createContext, ReactNode, useState } from "react"

export const  AppContext = createContext<any>(null)
export type userTable = {

    userid:string,
    firstName:string,
    lastName:string,
    phone:string,
    role:string,
    vendorid:string
}
//Demo User Data
export const _DEV_MODE_DEMO_USERS:userTable[] = [
 {
    userid:"0",
    firstName:"John",
    lastName:"Doe",
    phone:"555-555-5555",
    role:"contractor",
    vendorid:"1"
 },
 {
    userid:"1",
    firstName:"Jane",
    lastName:"Doe",
    phone:"666-555-5555",
    role:"client",
    vendorid:""
 },
 {
    userid:"2",
    firstName:"Taylor",
    lastName:"Swith",
    phone:"777-555-5555",
    role:"vendor",
    vendorid:""
 },
 {
    userid:"3",
    firstName:"Ben",
    lastName:"Joe",
    phone:"888-555-5555",
    role:"contractor",
    vendorid:"1"
 }

]
export const getUser = (userid:string) =>{

    const user: userTable|boolean = _DEV_MODE_DEMO_USERS.find(p => p.userid === userid)  || false
    if(user){
      return(user)
    }
    return(false)
  
}
export const _DEV_MODE_DEMO_CLIENT = (userid:string) => {
     const user = getUser(userid);
     if(user !== false ){
     return{...user,lastName:`${user.lastName} [CLIENT]`}
     }
     return(user)
   }
export const AppProvider = ({children} : {children:ReactNode}) =>{

   const [mount,setMounted] = useState(false);
   const [reverseStack,setReverseStack] = useState(false);
   const [devMode,setDevMode] = useState(false);
   const [userInfo,setUserInfo] = useState(getUser("0")); 
   const [client,setClient] = useState<userTable | boolean>(_DEV_MODE_DEMO_CLIENT("1"));
   
    return(

        <AppContext.Provider value={{mount,setMounted,reverseStack,setReverseStack,devMode,setDevMode,setUserInfo,userInfo,client,setClient}}>
        {children}
        </AppContext.Provider>
    )

}