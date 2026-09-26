using UnityEngine;
using System.Collections;
using SharpNeat.Phenomes;
using System.Collections.Generic;


public  struct CellStructure8{
	public    GameObject cell;
	public int typeOfCell;
	public int levelFromRoot;
	public int levelInRegion;
	public int orientat;

	public CellStructure8(GameObject Ob, int type, int level1, int level2, int orientation)
	{
		cell=Ob;
		typeOfCell=type;
		levelFromRoot=level1;
		levelInRegion=level2;
		orientat = orientation;

	}
}

public class creatureController8 : UnitController {


	bool IsRunning;
	IBlackBox myBox;
	//    public double[] cellState;
	public float penalty;
	private Vector2 firstPosition;
	private Vector2 oldPosition;
	private Vector2 midPosition;
	private int numberOfCells;
	private int noCells;

	public List <CellStructure8> grid;
	public GameObject myPrefab;
	public int size;
	bool created ;
	float snap;

	uint generation;


	void Awake(){    


	}



	void Start () {

		firstPosition = new Vector2(0,0);
		midPosition = new Vector2(0,0);
		oldPosition = new Vector2(0,0);

		GameObject Newcell = (GameObject)Instantiate (myPrefab);
		Newcell.name = "0";
		Newcell.transform.parent = this.transform;

		Newcell.transform.position = new Vector3 (0, 0, 0);
		CellStructure8 cellnew = new CellStructure8 (Newcell,0,0,0,0);
		grid = new List<CellStructure8>();
		grid.Add(cellnew);
		penalty =1;
		created = false;



	}



	// Update is called once per frame
	void FixedUpdate()
	{



		GameObject evaluation = GameObject.Find ("evaluation");
		Optimizer evalScript = evaluation.GetComponent<Optimizer> ();
		float HalfTime = evalScript.TrialDuration / 2;
		generation = evalScript.Generation;
		noCells =  (int) (5 + generation / 100 );

		if (IsRunning) {
			if (grid.Count < noCells) {

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
						inputArr [4] = 0;
						inputArr [5] = 0;
						inputArr [6] = 0;
						inputArr [7] = 0;



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


						Vector3 newPosition = grid [i].cell.transform.position + newOrientation (orientation);


						if (checkSpace (newPosition)) {
						GameObject NewChildcell = (GameObject)Instantiate (myPrefab);
						NewChildcell.name = grid.Count.ToString ();
						NewChildcell.transform.parent = this.transform;
						NewChildcell.transform.position = newPosition;
						CellStructure8 ncell = new CellStructure8 (NewChildcell, 0, 0, 0, orientation);


						if (type == 0) {

							FixedJoint attachment2 = grid [i].cell.AddComponent<FixedJoint> ();
							attachment2.connectedBody = NewChildcell.GetComponent< Rigidbody> ();
							ncell.levelInRegion++;
							ncell.levelFromRoot = grid [i].levelFromRoot + 1;
							grid.Add (ncell);
						} else if (type == 1) {
							HingeJoint attachment3 = grid [i].cell.AddComponent<HingeJoint> ();
							attachment3.connectedBody = NewChildcell.GetComponent< Rigidbody> ();
							ncell.levelInRegion = 0;
							ncell.levelFromRoot = grid [i].levelFromRoot + 1;
							grid.Add (ncell);

							   }
						}
					}
			} else if (created == false) {

				snap = Time.time;
				firstPosition = savePosition (this.transform);
				created = true;



				foreach (CellStructure8 thiscell in grid) {

					thiscell.cell.GetComponent<Rigidbody> ().useGravity = true;
					if (thiscell.levelInRegion == 0)
						foreach (CellStructure8 otherCells in grid)
							if ((thiscell.cell.name != otherCells.cell.name) && (otherCells.levelInRegion == 0)) {
								SpringJoint attachment0 = thiscell.cell.AddComponent<SpringJoint> ();
								attachment0.connectedBody = otherCells.cell.GetComponent< Rigidbody> ();
								attachment0.spring = 100;
								attachment0.minDistance = Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);
								attachment0.maxDistance = attachment0.minDistance;
								penalty= penalty * (float)1.2;
							}

				}    
			}

			if (created) {


				if ((Time.time - snap < HalfTime) && (Time.time - snap > HalfTime-0.1))
				{
					Debug.Log((Time.time - snap));
					midPosition = savePosition (this.transform);
				}

				foreach (CellStructure8 thiscell in grid) {

					SpringJoint[] childLinks = thiscell.cell.GetComponents<SpringJoint> ();

					if (childLinks!=null)
						foreach (SpringJoint childLink in childLinks) 
							foreach (CellStructure8 otherCells in grid)
								if (childLink.connectedBody.name == otherCells.cell.name){

									ISignalArray inputArr = myBox.InputSignalArray;
									inputArr [0] = thiscell.typeOfCell;
									inputArr [1] = thiscell.levelFromRoot;
									inputArr [2] = thiscell.levelInRegion;
									inputArr [3] = thiscell.orientat;
									inputArr [4] = otherCells.typeOfCell;
									inputArr [5] = otherCells.levelFromRoot;
									inputArr [6] = otherCells.levelInRegion;
									inputArr [7] = otherCells.orientat;
									inputArr [8] = Vector3.Distance (thiscell.cell.transform.position, otherCells.cell.transform.position);

									myBox.Activate ();

									ISignalArray outputArr = myBox.OutputSignalArray;

									float variation = (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [9] + (float)0.00001) + (float)outputArr [10]));
									//    penalty = penalty + (float)(outputArr [10]/outputArr [9])/1000;
									//float variation =  (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12]));

									childLink.minDistance += variation;
									//childLink.minDistance * (1 + (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12])));
									childLink.maxDistance = childLink.minDistance;}

				}

			}

			/*ISignalArray inputArr = myBox.InputSignalArray;

                //inputArr [0] = Mathf.Sin(Time.time/(float)cycle);
                //inputArr [2] = Mathf.Cos(Time.time);
                inputArr [0] = 1;
                inputArr [1] = 1;
                inputArr [2] = 1;
                inputArr [3] = 1;

                myBox.Activate ();

                ISignalArray outputArr = myBox.OutputSignalArray;


                foreach (Transform child in transform) {
                    int cellFrom = int.Parse (child.name);
                    SpringJoint[] childLinks = child.GetComponents<SpringJoint> ();

                    foreach (SpringJoint childLink in childLinks) {
                        int cellTo = int.Parse (childLink.connectedBody.name);


                        float variation = (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12]));

                        childLink.minDistance = 1 + variation;
                        //childLink.minDistance * (1 + (float)0.15 * (Mathf.Sin ((float)2 * Time.time * Mathf.PI / ((float)outputArr [cellFrom + 12] + (float)0.00001) + (float)outputArr [cellFrom * 2 + 12]) + Mathf.Sin (2 * Time.time * Mathf.PI / ((float)outputArr [cellTo + 12] + (float)0.00001) + (float)outputArr [cellTo * 2 + 12])));
                        childLink.maxDistance = childLink.minDistance;
                    }
                    
                    //oldPosition = midPosition;
                    //penalty = penalty + Vector2.Distance (midPosition, oldPosition);

                }    
            */

		}
	}

	public void OnJointBreak (float breakforce){
		penalty = 100000000;
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
		Vector2 origin = new Vector2 (0, 0);
		float fit = Vector2.Distance (midPosition, oldPosition) + Vector2.Distance (origin, oldPosition);

		return fit/penalty;


	}



	float[] checkNNType (IBlackBox box, int type, int level1, int level2){
		ISignalArray inputArr = box.InputSignalArray;
		inputArr [0] = type;
		inputArr [1] = level1;
		inputArr [2] = level2;

		box.Activate ();
		ISignalArray outputArr = box.OutputSignalArray;
		float [] probs = new float[3];

		for (int i = 0; i<3;i++)

			probs[i]= (float)outputArr [i];
		return probs;

	}

	float[] checkNNOrient (IBlackBox box, int type, int level1, int level2, int orient){
		ISignalArray inputArr = box.InputSignalArray;
		inputArr [0] = type;
		inputArr [1] = level1;
		inputArr [2] = level2;
		inputArr [6] = orient;

		box.Activate ();
		ISignalArray outputArr = box.OutputSignalArray;
		float [] probs = new float[6];

		for (int i = 6; i<12;i++)

			probs[i]= (float)outputArr [i];
		return probs;

	}

	float[] checkNNLink (IBlackBox box, int type1, int level1, int level2,int type2, int level3, int level4){
		ISignalArray inputArr = box.InputSignalArray;
		inputArr [0] = type1;
		inputArr [1] = level1;
		inputArr [2] = level2;
		inputArr [3] = type2;
		inputArr [4] = level3;
		inputArr [5] = level4;
		box.Activate ();
		ISignalArray outputArr = box.OutputSignalArray;
		float [] probs = new float[3];

		for (int i = 3; i<6;i++)
			probs[i]= (float)outputArr [i];
		return probs;

	}


	bool checkSpace (Vector3 posit){
		bool presence = true;
		foreach (CellStructure8 cellPosit in grid)
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





//void OnGUI()
//{
//    GUI.Button(new Rect(10, 200, 100, 100), "Forward: " + MovingForward + "\nPiece: " + CurrentPiece + "\nLast: " + LastPiece + "\nLap: " + Lap);
//}

/*
            List<SpringJoint> joints = new List<SpringJoint>();

            foreach (Transform child in transform) {
                SpringJoint[] childLinks = child.GetComponents<SpringJoint> ();
                for (int count = 0; count < childLinks.Length; count++) {
                    joints.Add(childLinks [count]);

                }

            }*/

//    for (int count = 0; count < childLinks.Length; count++) 

//        int from = int.Parse(childLinks [count].gameObject.name);
//        int to = int.Parse(childLinks [count].connectedBody.name);

//float m =(float)outputArr [0];
//float M =(float)outputArr [1 ];
//float p =(float)outputArr [2];
//float o = (float)outputArr [3];

/*
            for (int count = 0; count < joints.Count; count++) {


                GameObject jointFrom = joints[count].transform.parent.gameObject;
                GameObject jointTo = joints[count].connectedBody;


                    
                joints[count].minDistance = joints[count].minDistance (1 + 0.15*(Mathf.Sin(2*Time.time*Mathf.PI/ 
                (float)outputArr [count + 1];

                //    if (outputArr [count + 2] < 0.4) {
                //        penalty = penalty + (float)0.005;
                //    }
                //(float)outputArr [count] * (1 + Mathf.Sin ((Time.time / 2) * Mathf.PI * 2));
                //    else {
                //joints [count].minDistance = 1+ (float)outputArr [count + 1];
                //    joints [count].maxDistance = joints [count].minDistance;
                //joints[count].spring = 300*(float)outputArr [count + 1];
                //    }

                /*else if (outputArr [count] > 0.9999999) {

                    //                    HingeJoint hingejoint = new HingeJoint (gameObject, joints [count].connectedBody);
                    GameObject jointFrom = joints[count].transform.parent.gameObject;
                    HingeJoint newhingejoint = jointFrom.AddComponent <HingeJoint>();
                    newhingejoint.connectedBody = joints [count].connectedBody;
                    Destroy (joints [count].gameObject);

                }
                //joints [count].minDistance = (float)outputArr[count+4]*(M - m) / 2 * (1 + Mathf.Sin((Time.time+o) * Mathf.PI * 2 / p)) + m;;
                //joints [count].maxDistance = (float)outputArr[count+4]*(M - m) / 2 * (1 + Mathf.Sin((Time.time+o) * Mathf.PI * 2 / p)) + m;;


            //cycle=outputArr[0];
        */            
