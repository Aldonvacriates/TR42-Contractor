import { RootStackParamList } from "@/App"
import { ContactCard } from "@/components/ContactCard"
import { MainFrame } from "@/components/MainFrame"
import { SearchBar } from "@/components/SearchBar"
import { AppContext, demoUsers } from "@/contexts/AppContext"
import { RouteProp, useNavigation, useRoute } from "@react-navigation/native"
import { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { FC, useContext, useState } from "react"


export const Contacts:FC = (props) => {
    
 
    const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
    const {client} = useContext(AppContext)
    const contacts = (client) ?  [...demoUsers,client] : demoUsers
    const  [nameSearch,setNameSearch] = useState("");
    const  route = useRoute<RouteProp<RootStackParamList,'Contacts'>>();
    const sort = route.params?.sort
  
    const Search:FC = () =>{
       return(
           <SearchBar onClick={(msg:string)=>{setNameSearch(msg)}}/>
       )
    }
    return(<>
    <MainFrame header="home" headerMenu={["Menu2",["Contacts"]]} injectHeader={<Search/>}>
    
      {
        contacts.filter(ct => (`${ct.firstName.toUpperCase()} ${ct.lastName.toUpperCase()}`).includes((sort && client) ? `${client.firstName} ${client.lastName}`.toUpperCase() : nameSearch.toUpperCase())).map((item) =>{
          return( <ContactCard key={item.userid} contactId={item.userid} phoneNumber={item.phone} name={`${item.firstName} ${ item.lastName}`}/>)
        })
      }
    
     
    </MainFrame>
    
    
    </>)
}
