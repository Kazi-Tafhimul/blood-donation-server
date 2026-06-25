const dns = require('node:dns/promises');
dns.setServers(["1.1.1.1", "8.8.8.8"])
const express = require('express');
const cors = require('cors');
const app = express();
const port = 5000;
require('dotenv').config()
app.use(cors());
app.use(express.json());
const { MongoClient, ServerApiVersion } = require('mongodb');
app.get('/', (req,res)=>{
    res.send("hello world");

})



const uri = process.env.MONGODB_URI;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});

async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    await client.connect();

    const database = client.db("bloodlink_new")
    const requestCollection = database.collection("requests");
    app.post('/api/requests', async(req,res)=>{
      const request = req.body;
      const result = await requestCollection.insertOne(request);
      res.send(result);

    })
    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log("Pinged your deployment. You successfully connected to MongoDB!");
  } finally {
    // Ensures that the client will close when you finish/error
    //await client.close();
  }
}
run().catch(console.dir);

app.listen(port, ()=>{
    console.log("app listening on port ${port}");
})