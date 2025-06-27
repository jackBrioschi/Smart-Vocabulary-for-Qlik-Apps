const enigma = require("enigma.js");
const schema = require("enigma.js/schemas/12.612.0");
const WebSocket = require("ws");
const OpenAI = require("openai");
const dotenv = require("dotenv");
// Load environment variables from .env.dev file
dotenv.config({ path: '.env.dev' });

// QIX interface or session apps, change this to an existing app guid if you intend to open that app:
// replace with your information
const appId = process.env.QLIK_CLOUD_APPID;
const tenant = process.env.QLIK_CLOUD_TENANT;
const apiKey = process.env.QLIK_CLOUD_APIKEY;
const url = `wss://${tenant}/app/${appId}`;


// establish a connection to OpenAI APIs
 const client = new OpenAI({apiKey:process.env.OPENAI_APIKEY});


(async () => {
  const session = enigma.create({
    schema,
    createSocket: () =>
      new WebSocket(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }),
  });

  // bind traffic events to log what is sent and received on the socket:
  session.on("traffic:sent", (data) => console.log("sent:", data));
  session.on("traffic:received", (data) => console.log("received:", data));

  try {
    const global = await session.open();
    //Open app doc
    const app = await global.openDoc(appId);

    //Retrieve all app infos to understand which are the id of the different components
    const allInfos = await app.getAllInfos();

    //Retrieve only master measures and dimensions from allInfos
    const masterItems = allInfos.filter(item => 
      item.qType === 'measure' || item.qType === 'dimension'
    );

    //Retrieve the vocabulary
    const vocabulary = await app.getObject({"qId":"BusinessVocabulary"});

    //getProperties to retrieve the content of the vocabulary
    const vocabulary_layout = await vocabulary.getProperties({}); 

    //Prepare the new layout to be filled with synonisms for each entry
    const new_vocab= {qInfo:{qId:"BusinessVocabulary",qType:"BusinessVocabulary"},qMetaDef:{},vocabularies:[{entries:[],unresolvedEntries:[], sampleQueries:[],locale:"en"}]};

    //Loop through the master items and retrieve metadata (title, description...)
    for (let x=0; x< masterItems.length; x++){
      if(masterItems[x].qType == 'measure'){
         var masterItem= await app.getMeasure({"qId":masterItems[x].qId});
      }
      else{
        var masterItem= await app.getDimension({"qId":masterItems[x].qId});
      }
      var masterProp = await masterItem.getProperties({});
      console.log("Master Item ", masterProp.qMetaDef.title);

      //Invoke OpenAI APIs for retrieving synonism
      const response = await client.responses.create({
          model: "gpt-4.1",
          input: "I need to fill a metadata vocabulary with synonyms of measures and dimensions for data analysis purposes. Can you give me an array of max 6 synonyms of the word "+masterProp.qMetaDef.title+" that users could use to query the data? I want as the output just an array, without any additional sentences. I also give you a bit more of context regarding what the term means: "+ masterProp.qMetaDef.description
      });
      const list_of_terms = response.output_text;

      
      var newTerm = {id: masterItems[x].qId,
                      terms:JSON.parse(list_of_terms),
                      appliedTo:[{"libItemRef":  masterItems[x].qId,}]
                    }
      console.log("New entry created ", JSON.stringify(newTerm))
      new_vocab.vocabularies[0].entries.push(newTerm);
    
    //Update the vocabulary
    const result_set = await vocabulary.setProperties({"qProp":new_vocab});  
      
    }
        
  } catch (err) {
    console.log('An unexpected error thrown:', err);
  }

  session.close();
})();