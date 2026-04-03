import * as Font from "expo-font";

 const fonts = {

     "poppins-regular": require("../assets/fonts/Poppins-Regular.ttf"),
     "poppins-bold": require("../assets/fonts/Poppins-Bold.ttf")

        
}
export default async function LoadFonts(){

   
 try{
    await Font.loadAsync(fonts)
    return(true);
}
catch(e){
    
   console.log(e);
   return(false);
}

}

