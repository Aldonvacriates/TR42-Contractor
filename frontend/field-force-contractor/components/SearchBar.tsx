import { Styles } from '@/constants/Styles';
import { AppContext } from '@/contexts/AppContext';
import { FC, useContext, useEffect, useState } from "react";
import { Keyboard, Pressable, Text, TextInput, View } from 'react-native';


type props = {

    placeHolder?:string,
    buttonText?: string
    multiline?: boolean
    onClick:Function
    resetOnSubmit?:Boolean
    reactKeyboard?:Boolean
}

export const SearchBar:FC<props> = (props) => {
 const searchPlaceHolder = props.placeHolder || "Search...";
 const buttonText = props.buttonText || "Submit";
 const[message,setMessage] = useState<string>("");
 const [inputHeight,setInputHeight] = useState<number>(37);
 const [floatHeight,setFloatHeight] = useState<number>(0);
 const {menuHeight} = useContext(AppContext);
 const maxInputHeight = 110;

 useEffect(() => {
  if(props.reactKeyboard){
  Keyboard.addListener("keyboardDidShow",(event) => {setFloatHeight(((event.endCoordinates.height - menuHeight) > 0) ? event.endCoordinates.height - menuHeight : 0)})
  Keyboard.addListener("keyboardDidHide",() => {setFloatHeight(0)})
  }

},[])

    return(<>
     
    <View style={Styles.SearchBar.Bar}>
        <TextInput
          value={message}
          onChangeText={setMessage}
          multiline={props.multiline}
          onContentSizeChange={(event) => {
            if (props.multiline) {
              setInputHeight(Math.min(maxInputHeight, Math.max(37, event.nativeEvent.contentSize.height)));
            }
          }}
          scrollEnabled={props.multiline && inputHeight >= maxInputHeight}
          textAlignVertical={props.multiline ? "top" : "center"}
          style={[
            Styles.SearchBar.SearchInput,
            props.multiline && Styles.SearchBar.MessageInput,
            props.multiline && {height: inputHeight}
          ]}
          placeholder={searchPlaceHolder}
        />
        <Pressable onPress = {() =>{props.onClick(message); (props.resetOnSubmit)&& setMessage(""); setInputHeight(37);}} style={({pressed}) => 
            [Styles.SearchBar.SearchButton,
              {backgroundColor: (pressed) ? Styles.SearchBar.SearchButtonPressed.backgroundColor : Styles.SearchBar.SearchButton.backgroundColor}
            ]}>
              {({pressed}) => 
                  {
                    return(<Text style={
                      [Styles.SearchBar.SearchButtonText,
                        {
                          color: (pressed) ? Styles.SearchBar.SearchButtonPressed.color : Styles.SearchBar.SearchButtonText.color
                        }
                      ]
                    }>{buttonText}</Text>)                      
                  }
              }
         </Pressable>
        
    </View>
    <View style={[Styles.Chat.floatBox,{height:floatHeight}]}/>
    </>

    )
}
