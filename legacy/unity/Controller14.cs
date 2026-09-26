using UnityEngine;
using System.Collections;
using SharpNeat.Phenomes;
using System.Collections.Generic;



public class Controller14 : UnitController {


	bool IsRunning;
	IBlackBox myBox;
	//    public double[] cellState;
	public float penalty;
	private Vector2 firstPosition;
	private Vector2 oldPosition;
	private Vector2 midPosition;
	private int numberOfCells;
	private int noCells;
	private int noWorkingJoints=0;

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


	void Awake(){   
		firstPosition = new Vector2(0,0);
		midPosition = new Vector2(0,0);
		oldPosition = new Vector2(0,0);

		GameObject Newcell = (GameObject)Instantiate (myPrefab);
		Newcell.name = "0";
		Newcell.transform.parent = this.transform;

		int posX = Random.Range (-20, 40);
		int posZ = Random.Range (-40, 20);
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
		noCells =  (int) (9 + generation / 70 );

		int noRegions = 0;

		while (grid.Count < noCells) {

			int size = grid.Count;

			ISignalArray inputArr = myBox.InputSignalArray;

			for (int i = 0; i < size; i++)
				if (grid.Count < noCells) {
					//inputArr [0] = Mathf.Sin(Time.time/(float)cycle);
					//inputArr [2] = Mathf.Cos(Time.time);
					inputArr [0] = grid [i].typeOfCell;
					inputArr [1] = grid [i].levelFromRoot;
					inputArr [2] = grid [i].levelInRegion;
					inputArr [3] = grid [i].orientat;
					inputArr [4] = grid.Count/noCells;
					inputArr [5] = 0;
					inputArr [6] = 0;
					inputArr [7] = 0;
					inputArr [8] = 0;
					inputArr [9] = 0;
					inputArr [10] = 0;
					inputArr [11] = 0;



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



					Vector3 newPosition = grid [i].cell.transform.position + newOrientation (orientation);


					if (checkSpace (newPosition)) {
						GameObject NewChildcell;
						if (typeCell == 0)
							NewChildcell = (GameObject)Instantiate (myPrefab);
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
							hingeSpring.spring = 10;
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


						SpringJoint attachment0 = thiscell.cell.AddComponent<SpringJoint> ();
						attachment0.connectedBody = otherCells.cell.GetComponent< Rigidbody> ();
						attachment0.spring = 100;
						attachment0.minDistance = Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);
						attachment0.maxDistance = attachment0.minDistance;

						ISignalArray inputArr = myBox.InputSignalArray;
						inputArr [0] = thiscell.typeOfCell;
						inputArr [1] = thiscell.levelFromRoot;
						inputArr [2] = thiscell.levelInRegion;
						inputArr [3] = thiscell.orientat;
						inputArr [4] = thiscell.region;
						inputArr [5] = otherCells.typeOfCell;
						inputArr [6] = otherCells.levelFromRoot;
						inputArr [7] = otherCells.levelInRegion;
						inputArr [8] = otherCells.orientat;
						inputArr [9] = otherCells.region;
						inputArr[10]=Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);

						myBox.Activate ();

						ISignalArray outputArr = myBox.OutputSignalArray;

						LinkStructure12 link;
						if ((float)outputArr [8] > 0.2) {
							link = new LinkStructure12 (attachment0, (float)outputArr [9], (float)outputArr [10]);
							noWorkingJoints++;

						}
						else
							link = new LinkStructure12 (attachment0,0,0);
						ListOfSprings.Add (link);

					}
			}

			thiscell.cell.GetComponent<Rigidbody> ().useGravity = true;

		}
	}



	// Update is called once per frame
	void FixedUpdate()
	{

		if (IsRunning){

			foreach (CellStructure12 thiscell in grid) 
				penalty = penalty+thiscell.cell.GetComponent<Rigidbody> ().velocity.sqrMagnitude/1000; 

			if ((Time.time - snap < HalfTime) && (Time.time - snap > HalfTime-0.1))
			{
				Debug.Log((Time.time - snap));
				midPosition = savePosition (this.transform);
			}



			foreach (LinkStructure12 link in ListOfSprings)
			{
				if (link.amplitude+link.frequency >0)
				{
					float variation = (float) 0.15 * (Mathf.Sin ( 2 * (float) Time.time *  Mathf.PI / (link.frequency+ (float) 0.00001) + link.amplitude));
					//penalty= penalty + (float)0.01/noCells;
					//penalty = penalty + (variation*variation) / (float)(50* outputArr[9]+0.1);
					//float variation =  (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12]));

					link.joint.minDistance += variation;
					//childLink.minDistance * (1 + (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12])));
					link.joint.maxDistance = link.joint.minDistance;
				}

			}
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

		//return fit/(1+penalty);
		float ratio = Mathf.Sqrt(1+(noWorkingJoints-noCells)*(noWorkingJoints-noCells));




		if (fit > 4)
			fit = (10000 * fit / penalty) / ratio;
		else
			fit = 1 / 1000000;

		//return fit;

		for (int i = 0; i < numberOfCells;i++ )
			if (grid [i].cell.transform.position.y > 20)
				fit = 1 / 1000000;

		if (fit > 10) {
			//    string[] individual = SaveIndividual();
			//    System.IO.File.WriteAllLines (@"C:\Users\Public\TestFolder\WriteLines.txt", individual);
		}

		return fit;
	}        




	bool checkSpace (Vector3 posit){
		bool presence = true;
		foreach (CellStructure12 cellPosit in grid)
			if (cellPosit.cell.transform.position == posit)
				presence= false;
		return presence;}




	int Choose (float[] probs) {

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

	int ChooseFix (float[] probs) {

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

