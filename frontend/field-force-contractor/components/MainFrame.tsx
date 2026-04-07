import {Styles} from "../constants/Styles"
import {Assets} from "../constants/Assets"
<<<<<<< HEAD
import {useState,FC,ReactNode} from "react"
import {View,ImageBackground,Text,ScrollView} from "react-native"
import { SearchBar } from "../components/SearchBar"
=======
import {FC,ReactNode} from "react"
import {View,ImageBackground,Text,ScrollView,Image,} from "react-native"
import {Header, HeaderVariant} from "../components/Header"


>>>>>>> origin/editHeader
type Props ={
  children: ReactNode,
  header?: HeaderVariant,
}

export const MainFrame:FC<Props> = (props) =>{

  return(<>
    <ImageBackground source={Assets.backgrounds.MainFrame.MainbackgroundImage} style={Styles.MainFrame.BackgroundImageSize}>
      <View style={Styles.MainFrame.Window}>
        <View style={Styles.MainFrame.Header}>
          <Header header={props.header ?? "default"}/> 
          <Text style={Styles.MainFrame.DefaultText}> Top menu goes here</Text> 
        </View>

        <ScrollView contentContainerStyle={Styles.MainFrame.Body}>
          {
          props.children
          }
        </ScrollView>

        <View style={Styles.MainFrame.Footer}>
          <Text style={Styles.MainFrame.DefaultText}> Bottom Navigation Here</Text> 
          <View style={Styles.MainFrame.SpaceHeader}/>
        </View>

<<<<<<< HEAD
    <View style={Styles.MainFrame.Window}>
      <View  style={Styles.MainFrame.Header}>
        <View style={Styles.MainFrame.SpaceHeader}/>
        <SearchBar buttonText="Search" placeHolder="Search..."/>
        <Text style={Styles.MainFrame.DefaultText}>Header Here</Text>
        <Text style={Styles.MainFrame.DefaultText}>Menu Here</Text>
=======
>>>>>>> origin/editHeader
      </View>
    </ImageBackground>
 </>)
}