import {Styles} from "../constants/Styles"
import {Assets} from "../constants/Assets"
import {FC,ReactNode} from "react"
import {View,ImageBackground,Text,ScrollView,Image,} from "react-native"
import {Header,HeaderVariant} from "../components/Header"
import { Menu,MenuOptions}  from "./Menu"

type Props ={
  children?: ReactNode
  header?: HeaderVariant
  headerMenu?:MenuOptions
  footerMenu?:MenuOptions
  
}

export const MainFrame:FC<Props> = (props) =>{
 console.log(props.headerMenu)
  return(<>
    <ImageBackground source={Assets.backgrounds.MainFrame.MainbackgroundImage} style={Styles.MainFrame.BackgroundImageSize}>
      <View style={Styles.MainFrame.Window}>
       <View style={Styles.MainFrame.Header}>
        <View style={Styles.MainFrame.SpaceHeader}/>
        <Header  header={props.header}/>
        <Menu menuOptions={props.headerMenu} />
        </View>

        <ScrollView contentContainerStyle={Styles.MainFrame.Body}>
          {
          props.children
          }
        </ScrollView>

        <View style={Styles.MainFrame.Footer}>
          <Menu menuOptions={props.footerMenu}/>
          <View style={Styles.MainFrame.SpaceHeader}/>
        </View>

      </View>
    </ImageBackground>
 </>)
}
