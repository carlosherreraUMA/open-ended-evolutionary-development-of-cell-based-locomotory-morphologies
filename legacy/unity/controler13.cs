using UnityEngine;
using System.Collections;
using SharpNeat.Phenomes;
using System.Collections.Generic;



public class controler13 : UnitController {


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
	public int size;
	float snap;
	float HalfTime;
	uint generation;
	private int noRegions=1;
	GameObject plane;
	float energy;


	void Awake(){   
		plane = GameObject.Find ("Plane");
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
		//firstPosition = (posX,posZ);





	}



	void Start () {

		GameObject evaluation = GameObject.Find ("evaluation");
		Optimizer evalScript = evaluation.GetComponent<Optimizer> ();
		HalfTime = evalScript.TrialDuration / 2;
		generation = evalScript.Generation;
		energy = generation;
		noCells =  (int) (7 + Mathf.Sqrt (2*generation) - generation/90);


		while (grid.Count < noCells+(int) Random.Range(-1,1)) {

			int size = grid.Count;
			ISignalArray inputArr = myBox.InputSignalArray;

			for (int i = 0; i < size; i++)
				if (grid.Count < (noCells+(int) Random.Range(-1,1))) {
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


					Vector3 newPosition = grid [i].cell.transform.position + newOrientation (orientation);


					if (checkSpace (newPosition)) {


						if     (newPosition.y -1 < plane.transform.position.y)
							plane.transform.position= new Vector3 (0, newPosition.y-1, 0);


						GameObject NewChildcell = (GameObject)Instantiate (myPrefab);
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
							ncell.region = grid [i].region + 1;
							if (ncell.region > noRegions)
								noRegions = ncell.region;
							grid.Add (ncell);

						}
					
							Color newColor = NewChildcell.GetComponent<MeshRenderer> ().material.color;

							newColor.b = 1 / ((float)ncell.region + 1);
						newColor.r = 1 / (1 + ncell.region % 2);
						newColor.g = 1 / (1 + ncell.region % 3);
							NewChildcell.GetComponent<MeshRenderer> ().material.color = newColor;
						}
				}
		}
		snap = Time.time;
		firstPosition = savePosition (this.transform);


		foreach (CellStructure12 thiscell in grid) {
		if (thiscell.springCell)
			 {
				foreach (CellStructure12 otherCells in grid)
					if ((thiscell.region < otherCells.region) && (otherCells.springCell)) {


						SpringJoint attachment0 = thiscell.cell.AddComponent<SpringJoint> ();
						attachment0.connectedBody = otherCells.cell.GetComponent< Rigidbody> ();
						attachment0.spring = 100;
						attachment0.minDistance = Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);
						attachment0.maxDistance = attachment0.minDistance;

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

						LinkStructure12 link;
						if ((float)outputArr [8] > 0.5) {
							link = new LinkStructure12 (attachment0, (float)outputArr [9], (float)outputArr [10]);
							noWorkingJoints++;
							penalty = penalty*(1+(float)outputArr [9]);
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


			if ((Time.time - snap < HalfTime) && (Time.time - snap > HalfTime-0.1))
			{
				Debug.Log((Time.time - snap));
				midPosition = savePosition (this.transform);
			}

			foreach (LinkStructure12 link in ListOfSprings)
			{
				if (link.amplitude+link.frequency >0)
				{
					float variation = (float) 0.15 * (Mathf.Sin ( 2 *  Time.time *  Mathf.PI * link.frequency+ link.amplitude));
					//float variation = (float) 0.15 * (Mathf.Sin ( 2 * (float) Time.time *  Mathf.PI / (link.frequency+ (float) 0.00001) + link.amplitude));
					//penalty= penalty + (float)0.01/noCells;
					//penalty = penalty + (variation*variation) / (float)(50* outputArr[9]+0.1);
					//float variation =  (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12]));
					energy = energy-variation;
					if (energy>0)
					link.joint.minDistance += variation;
					//childLink.minDistance * (1 + (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12])));
					link.joint.maxDistance = link.joint.minDistance;
				}

			}
			for (int i = 0; i < numberOfCells; i++)
				if (grid [i].cell.transform.position.y > 5) {
					penalty = 100000000000000;
				}
						
		}
	}



	public void SaveIndividual(){

		string[] cells =new string[1000];
		string[] links =new string[1000];
		string heading = "<?xml version=1.0 encoding=us-ascii?> <creature>";


		//        <cells>
		//        <cell id="0" x_offset="-5.0" y_offset="5.0" z_offset="0.0"/>

		for (int i = 0; i < noCells; i++) {
			cells [i] = "<cell cell id=" + grid [i].cell.name
				+ " x_offset=" + grid [i].cell.transform.position.x
				+ " y_offset=" + grid [i].cell.transform.position.y
				+ " z_offset=" + grid [i].cell.transform.position.z+
				"/cell>";

			HingeJoint[] hingeLinks = grid [i].cell.GetComponents<HingeJoint> ();
			FixedJoint[] fixedLinks = grid [i].cell.GetComponents<FixedJoint> ();


			for (int j = 0; j < hingeLinks.Length; j++) {

				cells [numberOfCells + j] = "  <Link type=hinge from=" + hingeLinks [j].name +
					" to=" + hingeLinks [j].connectedBody.name + "/Link>";
			}
			for (int j = 0; j < fixedLinks.Length; j++) {

				links [j + numberOfCells + hingeLinks.Length] = "  <Link type=fixed from=" + fixedLinks [j].name +
					" to=" + fixedLinks [j].connectedBody.name + "/Link>";
			}




			for (int k = 0; k < ListOfSprings.Count; i++)
				links [noCells + k] = "  <Link type=spring from=" + ListOfSprings [k].joint.name +
					" to=" + ListOfSprings [k].joint.connectedBody.name +
					" min_distance=" + ListOfSprings [k].joint.minDistance.ToString() +
					"amplitude= " + ListOfSprings [k].amplitude.ToString()  +
					"frequency= " + ListOfSprings [k].frequency.ToString() ;

		}

		// WriteAllLines creates a file, writes a collection of strings to the file,
		// and then closes the file.  You do NOT need to call Flush() or Close().
		System.IO.File.WriteAllLines(@"C:\Users\Public\TestFolder\WriteLines.txt", cells);
		//    System.IO.File.WriteAllLines(@"C:\Users\Public\TestFolder\WriteLines.txt", links);
	}


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

				thisposition.x = thisposition.x + child.transform.position.x;
				thisposition.y = thisposition.y + child.transform.position.z;
				numberOfCells++;
		}
		return thisposition / numberOfCells;
	}



	public override float GetFitness()
	{

		oldPosition = savePosition (this.transform);

		float fit = Vector2.Distance (midPosition, oldPosition)+Vector2.Distance (firstPosition, oldPosition);

		//return fit/(1+penalty);
		float ratio = 1+Mathf.Abs(noWorkingJoints-noCells);

		//    if (fit > 10)
		//        SaveIndividual ();

		if (fit <3)
			fit = fit / 10000;

		//fit =10*fit / (ratio*penalty*noRegions);
		fit =fit / (noRegions*penalty);
		return fit;

	}        




	bool checkSpace (Vector3 posit){
		bool presence = true;
		foreach (CellStructure12 cellPosit in grid)
			if (cellPosit.cell.transform.position == posit)
				presence= false;
		return presence;}




	int Choose(float[] probs) {

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

	int ChooseFix  (float[] probs) {

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

