using UnityEngine;
using System.Collections;
using SharpNeat.Phenomes;
using System.Collections.Generic;



public class controler15 : UnitController {


	bool IsRunning;
	IBlackBox myBox;
	//    public double[] cellState;
	public float penalty;
	private Vector2 firstPosition;
	private Vector2 oldPosition;
	private Vector2 midPosition;
	private int numberOfCells;
	public int noCells;
	private int noWorkingJoints=0;
	int posX;
	int posZ;

	public List <CellStructure12> grid;
	public List<LinkStructure12> ListOfSprings;
	public GameObject myPrefab;
	public GameObject myPrefabCube;
	public int size;
	float snap;
	float HalfTime;
	uint generation;
	bool splodes= false;
	float TotalEffort;
	float TotalVelocity=0;
	Vector3 GlobalVelocity;


	void Awake(){   
		firstPosition = new Vector2(0,0);
		midPosition = new Vector2(0,0);
		oldPosition = new Vector2(0,0);

		GameObject Newcell = (GameObject)Instantiate (myPrefab);
		Newcell.name = "0";
		Newcell.transform.parent = this.transform;

		posX = Random.Range (-20, 40);
		posZ = Random.Range (-40, 20);
		Newcell.transform.position = new Vector3 (posX, 0, posZ);
		CellStructure12 cellnew = new CellStructure12 (Newcell,0,0,0,0, true, 1);
		grid = new List<CellStructure12>();
		grid.Add(cellnew);
		ListOfSprings = new List<LinkStructure12>();
		penalty = 1;





	}



	void Start () {

		GameObject evaluation = GameObject.Find ("evaluation");
		Optimizer evalScript = evaluation.GetComponent<Optimizer> ();
		HalfTime = evalScript.TrialDuration / 2;
		generation = evalScript.Generation;
		noCells =  (int) (1 + Mathf.Sqrt(generation)+2*(int)Mathf.Sin(100*Time.time));

		int noRegions = 0;

		while (grid.Count < noCells) {

			int size = grid.Count;

			ISignalArray inputArr = myBox.InputSignalArray;

			for (int i = 0; i < size; i++)
				if (grid.Count < noCells) {
					//inputArr [0] = Mathf.Sin(Time.time/(float)cycle);
					//inputArr [2] = Mathf.Cos(Time.time);
					inputArr [0] = grid [i].typeOfCell;
					inputArr [1] = 1/(grid [i].levelFromRoot+1);
					inputArr [2] = 1/(grid [i].levelInRegion+1);
					inputArr [3] = 1/(grid [i].orientat+1);
					inputArr [4] = 1/grid [i].region;
					inputArr [5] = grid.Count/noCells;
					inputArr [6] =0 ;
					inputArr [7] = 0;
					inputArr [8] = 0;
					inputArr [9] = 0;
					inputArr [10] = 0;




					myBox.Activate ();

					ISignalArray outputArr = myBox.OutputSignalArray;

					float[] probOrient = new float[6];
					float[] probType = new float[2];
					float[] probTypeCell = new float[2];



					for (int j = 0; j < 6; j++)
						probOrient [j] = (float)outputArr [j];
					int orientation = Choose (probOrient);

					for (int j = 6; j < 8; j++)
						probType [j - 6] = (float)outputArr [j];
					int type = Choose (probType);

					bool SpringCell;
					if (outputArr [8] > 0.2)
						SpringCell = true;
					else
						SpringCell = false;

					for (int j = 9; j < 11; j++)
						probTypeCell [j - 9] = (float)outputArr [j];
					int typeCell = Choose (probType);



					Vector3 newPosition = grid [i].cell.transform.position + (int)(Mathf.Sqrt((1+noCells)/(1+grid.Count)))*newOrientation (orientation);



					if (checkSpace (newPosition)) {
						GameObject plane= GameObject.Find ("Plane");
						if     (newPosition.y -1 < plane.transform.position.y)
							plane.transform.position= new Vector3 (0, newPosition.y-1, 0);

						GameObject NewChildcell;
						if (typeCell == 0)
							NewChildcell = (GameObject)Instantiate (myPrefabCube);
						else 
							NewChildcell = (GameObject)Instantiate (myPrefab);

						NewChildcell.name = grid.Count.ToString ();
						NewChildcell.transform.parent = this.transform;
						NewChildcell.transform.position = newPosition;




						CellStructure12 ncell = new CellStructure12 (NewChildcell, 0, 0, 0, orientation, SpringCell, 0);


						if (type == 0) {

							FixedJoint attachment2 = grid [i].cell.AddComponent<FixedJoint> ();
							attachment2.connectedBody = NewChildcell.GetComponent< Rigidbody> ();
							ncell.levelInRegion++;
							ncell.levelFromRoot = grid [i].levelFromRoot + 1;
							ncell.region = grid [i].region;
							grid.Add (ncell);
						} else if (type == 1) {
							HingeJoint attachment3 = grid [i].cell.AddComponent<HingeJoint> ();
							attachment3.connectedBody = NewChildcell.GetComponent< Rigidbody> ();
							attachment3.useSpring = true;
							JointSpring hingeSpring = attachment3.spring;
							hingeSpring.spring = 1;
							ncell.levelInRegion = 0;
							ncell.levelFromRoot = grid [i].levelFromRoot + 1;
							ncell.region = noRegions + 1;
							noRegions++;
							grid.Add (ncell);

						}

						if (ncell.levelInRegion > 0) {
							Color newColor = NewChildcell.GetComponent<MeshRenderer> ().material.color;
							newColor.b = Mathf.Sqrt (1 / (ncell.region + 1));
							newColor.r = Mathf.Sqrt (1 / (ncell.region / 2 + 1));
							newColor.g = Mathf.Sqrt (1 / (ncell.region / 3 + 1));
							NewChildcell.GetComponent<MeshRenderer> ().material.color = newColor;
						}


						/*
                        if ((ncell.region + 1) / 3 == 0) {
                            newColor.b = Mathf.Sqrt (1 / (ncell.region + 1));
                            newColor.r = 1;
                            newColor.g = 1;
                        }
                        else if ((ncell.region+1) /3==1)
                        {
                            newColor.r = Mathf.Sqrt (1 / (ncell.region + 1));
                            newColor.b = 1;
                            newColor.g = 1;
                        }

                        else if ((ncell.region+1) /3==2)
                        {
                            newColor.g = Mathf.Sqrt (1 / (ncell.region + 1));
                            newColor.r = 1;
                            newColor.b = 1;
                        }        */

					}
				}
		}
		snap = Time.time;
		firstPosition = savePosition (this.transform);


		foreach (CellStructure12 thiscell in grid) {

			if (thiscell.springCell) {
				foreach (CellStructure12 otherCells in grid)
					if ((thiscell.region < otherCells.region) && (otherCells.springCell)) {





						ISignalArray inputArr = myBox.InputSignalArray;
						inputArr [0] =thiscell.typeOfCell;
						inputArr [1] = 1/(thiscell.levelFromRoot+1);
						inputArr [2] = 1/(thiscell.levelInRegion+1);
						inputArr [3] = 1/(thiscell.orientat+1);
						inputArr [4] = 1/thiscell.region;
						inputArr [5] = Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);
						inputArr [6] =    otherCells.typeOfCell;
						inputArr [7] = 1/(otherCells.levelFromRoot+1);
						inputArr [8] = 1/(otherCells.levelInRegion+1);
						inputArr [9] = 1/(otherCells.orientat+1);
						inputArr [10] = 1/otherCells.region;

						myBox.Activate ();

						ISignalArray outputArr = myBox.OutputSignalArray;

						float[] probType = new float[3];
						for (int j = 0; j < 2; j++)
							probType [j] = (float)outputArr [j+6];
						probType [2] = 2*(float)outputArr [8];
						int type = Choose (probType);

						switch (type){
						case 2:

							SpringJoint attachment0 = thiscell.cell.AddComponent<SpringJoint> ();
							attachment0.connectedBody = otherCells.cell.GetComponent< Rigidbody> ();
							attachment0.spring = 10;
							attachment0.minDistance = Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);
							attachment0.maxDistance = attachment0.minDistance;
							LinkStructure12 link;
							link = new LinkStructure12 (attachment0, (float) outputArr[8], (float)outputArr [9], (float)outputArr [10]);
							noWorkingJoints++;
							ListOfSprings.Add (link);
							break;

						case 0:
							FixedJoint attachment1 = thiscell.cell.AddComponent<FixedJoint> ();
							attachment1.connectedBody = otherCells.cell.GetComponent< Rigidbody> ();
							int oldregion= otherCells.region;
							foreach (CellStructure12 changecell in grid) 
								if (changecell.region == oldregion)
									changecell.region= thiscell.region;
							break;

						case 1:
							HingeJoint attachment2 = thiscell.cell.AddComponent<HingeJoint> ();
							attachment2.connectedBody = otherCells.cell.GetComponent< Rigidbody> ();
							break;


						}
					}

				thiscell.cell.GetComponent<Rigidbody> ().useGravity = true;

			}
		}

	}

	// Update is called once per frame
	void FixedUpdate()
	{

		if (IsRunning){

			foreach (CellStructure12 thiscell in grid) {
				GlobalVelocity += thiscell.cell.GetComponent<Rigidbody> ().velocity; 
				TotalVelocity += thiscell.cell.GetComponent<Rigidbody> ().velocity.magnitude;
			}
			penalty += TotalVelocity / ((float)0.00000001+GlobalVelocity.magnitude * noCells);

			if ((Time.time - snap < HalfTime) && (Time.time - snap > HalfTime-0.1))
			{
				Debug.Log((Time.time - snap));
				midPosition = savePosition (this.transform);
			}


			float penalty2=0;
			foreach (LinkStructure12 link in ListOfSprings)
			{
				if (link.amplitude+link.frequency >0)
				{
					float variation = link.range * (Mathf.Sin ((float)Time.time *link.frequency* Mathf.PI/50 + link.amplitude));
					penalty2= penalty2+(link.frequency)*(link.frequency);
					//penalty = penalty + (variation*variation) / (float)(50* outputArr[9]+0.1);
					//float variation =  (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12]));

					link.joint.minDistance += variation;
					//childLink.minDistance * (1 + (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12])));
					link.joint.maxDistance = link.joint.minDistance;
				}

			}
			;
			penalty = (penalty + penalty2) / 2;
		}
	}




	/*    public string[] SaveIndividual(){

        string[] cells =new string[noCells+1+ListOfSprings.Count];
        string links="";
        //string[] springs=new string[ListOfSprings.Count];
        string[] heading=new string[1];
        heading[0]= "<?xml version=1.0 encoding=us-ascii?> <creature>";


        //        <cells>
        //        <cell id="0" x_offset="-5.0" y_offset="5.0" z_offset="0.0"/>

        for (int i = 0; i < noCells; i++) {
            cells [i] = "<cell cell id=" + grid [i].cell.name
                + " x_offset=" + grid [i].cell.transform.position.x.ToString()
                + " y_offset=" + grid [i].cell.transform.position.y.ToString()
                + " z_offset=" + grid [i].cell.transform.position.z.ToString() +
            " /cell>";
        
            

            HingeJoint[] hingeLinks = grid [i].cell.GetComponents<HingeJoint> ();
            FixedJoint[] fixedLinks = grid [i].cell.GetComponents<FixedJoint> ();


            for (int j = 0; j < hingeLinks.Length; j++) {

                links+= "  <Link type=hinge from=" + hingeLinks [j].name +
                    " to=" + hingeLinks [j].connectedBody.name + "/Link>"+"/n";
            }
            for (int j = 0; j < fixedLinks.Length; j++) {

                links += "  <Link type=fixed from=" + fixedLinks [j].name +
                    " to=" + fixedLinks [j].connectedBody.name + "/Link>";
            }
            cells [noCells] = links;




            for (int k = 0; k < ListOfSprings.Count; i++)
                cells [k+noCells+1] = "  <Link type=spring from=" + ListOfSprings [k].joint.name +
                    " to=" + ListOfSprings [k].joint.connectedBody.name +
                    " min_distance=" + ListOfSprings [k].joint.minDistance.ToString() +
                    "amplitude= " + ListOfSprings [k].amplitude.ToString()  +
                    "frequency= " + ListOfSprings [k].frequency.ToString() ;

        }

        return cells;

        //System.IO.File.a AppendAllLines(@"C:\Users\Public\TestFolder\WriteLines.txt", links);
    }

*/
	public override void Stop()
	{
		this.IsRunning = false;
	}

	public override void Activate(IBlackBox box)
	{
		this.myBox = box;
		this.IsRunning = true;
	}

	public Vector2 savePosition (Transform T){

		Vector2 thisposition = new Vector2(0,0);
		numberOfCells = 0;
		foreach (Transform child in T) 
		{
			if (child.gameObject.name !="0"){
				thisposition.x = thisposition.x + child.transform.position.x;
				thisposition.y = thisposition.y + child.transform.position.z;
				numberOfCells++;
			}}
		return thisposition / numberOfCells;
	}



	public override float GetFitness()
	{

		oldPosition = savePosition (this.transform);


		float fit = Vector2.Distance (midPosition, oldPosition)+Vector2.Distance (firstPosition, oldPosition);
		fit = fit / (1+penalty);

		fit = fit * noCells;
        //return fit/(1+penalty);
        float ratio = Mathf.Sqrt(1+(noWorkingJoints-noCells)*(noWorkingJoints-noCells));


    

        if (fit > 4)
            fit =  fit / (1+penalty*ratio);
        else
            fit = 1 / 1000000;

        //return fit;



        if (fit > 10) {
        //    string[] individual = SaveIndividual();
        //    System.IO.File.WriteAllLines (@"C:\Users\Public\TestFolder\WriteLines.txt", individual);
        }
        if (fit <= 0)
            fit = (float)0.00000001;
         
		for (int i = 0; i < numberOfCells;i++ )
			if (grid [i].cell.transform.position.y > 20)
				fit = 1 / 1000000;
		return fit;
	}        




	bool checkSpace (Vector3 posit){
		bool presence = true;
		foreach (CellStructure12 cellPosit in grid)
			if (cellPosit.cell.transform.position == posit)
				presence= false;
		return presence;}




	int ChooseRandom (float[] probs) {

		float total = 0;

		foreach (float elem in probs) {
			total += elem;
		}

		float randomPoint = Random.value * total;

		for (int i= 0; i < probs.Length; i++) {
			if (randomPoint < probs[i]) {
				return i;
			}
			else {
				randomPoint -= probs[i];
			}
		}
		return probs.Length - 1;
	}

	int Choose(float[] probs) {

		float max = 0;
		int maxElements = 0;


		for (int i= 0; i < probs.Length; i++) {
			if (max < probs[i]) {
				max = probs [i];
				maxElements = i;
			}

		}

		return maxElements;
	}



	Vector3 newOrientation (int orient){
		Vector3 newPosition = new Vector3 (0,0,0);
		switch (orient) {
		case 0:
			newPosition  = new Vector3 (1, 0, 0);
			break;
		case 1:
			newPosition =new Vector3 (0, 1, 0);
			break;
		case 2:
			newPosition =new Vector3 (0, 0, 1);
			break;
		case 3:
			newPosition= new Vector3 (-1, 0, 0);

			break;
		case 4:
			newPosition =new Vector3 (0, -1, 0);

			break;
		case 5:
			newPosition= new Vector3 (0, 0, -1);
		break;}

		return newPosition;
	}


}
